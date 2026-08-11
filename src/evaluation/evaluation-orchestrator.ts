import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { chromium, type Browser } from 'playwright';
import type { AiProvider } from '../ai/provider.js';
import type { EvalCase, EvalSetSelection, EvaluationOrchestratorInput, EvaluationOrchestratorResult, ProductModel } from '../../types.js';
import { OpenAiProvider } from '../ai/openai-provider.js';
import { OpenAiCompatibleProvider } from '../ai/openai-compatible-provider.js';
import { currentAiCredential } from '../ai/provider-connection.js';
import { evalSetManifestPath, loadEvalSetCases, loadEvalSetManifest } from '../eval-set/eval-set-store.js';
import { analyzeCoverage } from '../eval-set/coverage-analyzer.js';
import { saveCoverageMatrix } from '../eval-set/coverage-store.js';
import { listProductModelVersions, loadProductModel } from '../product-model/product-model-store.js';
import { buildAdaptiveEvaluationReport } from '../report/adaptive-report.js';
import { evidencePacketSchema } from '../test-agent/schemas.js';
import { EvalPilotError } from '../utils/errors.js';
import { ensureDirectory, pathExists, writeJsonAtomic } from '../utils/file-system.js';
import { configForProject } from '../projects/project-registry.js';
import { runAdaptiveCase } from './adaptive-evaluation-service.js';
import { evaluationSourceFingerprint, generateEvaluationFoundation, loadEvaluationFoundationState, saveEvaluationFoundationState } from './evaluation-foundation.js';
import { evaluationOrchestratorInputSchema, evaluationOrchestratorResultSchema } from './schemas.js';
import { selectEvaluationCases } from './evaluation-selector.js';

const execFileAsync = promisify(execFile);

interface OrchestratorHooks {
  prepared?: (selection: EvalSetSelection, model: ProductModel) => Promise<void> | void;
  caseCompleted?: (completed: number, total: number, evalCase: EvalCase) => Promise<void> | void;
}

interface OrchestratorDependencies {
  provider?: AiProvider;
  launchBrowser?: () => Promise<Browser>;
}

export function configuredEvaluationProvider(): AiProvider {
  const credential = currentAiCredential();
  if (!credential) throw new EvalPilotError('尚未连接 AI 评测能力。请先在评测页选择一个模型服务并验证 Key。', 'AI_PROVIDER_NOT_CONFIGURED');
  if (credential.protocol === 'responses') return new OpenAiProvider({ apiKey: credential.apiKey, model: credential.model, baseUrl: credential.baseUrl });
  return new OpenAiCompatibleProvider({ providerId: credential.provider as 'deepseek' | 'kimi' | 'openai_compatible', displayName: credential.displayName, apiKey: credential.apiKey, model: credential.model, baseUrl: credential.baseUrl, screenshotInput: credential.screenshotInput });
}

async function ensureFoundation(projectId: string, outputDir: string, provider: AiProvider): Promise<{ model: ProductModel; cases: EvalCase[]; version: number }> {
  const versions = await listProductModelVersions(outputDir);
  const hasEvalSet = await pathExists(evalSetManifestPath(outputDir));
  const sourceFingerprint = await evaluationSourceFingerprint(outputDir);
  const state = await loadEvaluationFoundationState(outputDir);
  if (!versions.length || !hasEvalSet || (state !== null && state.sourceFingerprint !== sourceFingerprint)) {
    await generateEvaluationFoundation({ projectId, outputDir, provider, allowRemoteModel: true });
  }
  const currentVersions = await listProductModelVersions(outputDir);
  const modelVersion = currentVersions.at(-1);
  if (!modelVersion) throw new EvalPilotError('产品理解没有成功生成，请检查扫描证据后重试。', 'PRODUCT_MODEL_REQUIRED');
  const [model, cases, manifest] = await Promise.all([
    loadProductModel(outputDir, modelVersion),
    loadEvalSetCases(outputDir),
    loadEvalSetManifest(outputDir),
  ]);
  await saveEvaluationFoundationState(outputDir, { schemaVersion: 1, sourceFingerprint, productModelVersion: model.version, evalSetVersion: manifest.version, generatedAt: new Date().toISOString() });
  return { model, cases, version: manifest.version };
}

function startingUrlFor(evalCase: EvalCase, model: ProductModel, targetUrl: string): string {
  const entry = model.capabilities.find((item) => item.capabilityId === evalCase.capabilityId)?.entryPoints[0] ?? targetUrl;
  try { return new URL(entry, targetUrl).toString(); }
  catch { throw new EvalPilotError(`案例“${evalCase.title}”没有可用的起始页面。`, 'STARTING_URL_INVALID'); }
}

async function targetCommit(projectRoot: string): Promise<string | null> {
  try { return (await execFileAsync('git', ['-C', projectRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 4_000 })).stdout.trim() || null; }
  catch { return null; }
}

export async function runEvaluationOrchestrator(cwd: string, rawInput: EvaluationOrchestratorInput, hooks: OrchestratorHooks = {}, dependencies: OrchestratorDependencies = {}): Promise<EvaluationOrchestratorResult> {
  const input = evaluationOrchestratorInputSchema.parse(rawInput);
  const config = await configForProject(cwd, input.projectId);
  const provider = dependencies.provider ?? configuredEvaluationProvider();
  const foundation = await ensureFoundation(input.projectId, config.outputDir, provider);
  const selection = selectEvaluationCases({ model: foundation.model, cases: foundation.cases, depth: input.depth, capabilityIds: input.capabilityIds });
  if (!selection.cases.length) throw new EvalPilotError('所选功能没有可运行的评测案例。请重新整理案例或调整功能范围。', 'EVALUATION_CASE_NOT_FOUND');
  await hooks.prepared?.(selection, foundation.model);

  const browser = await (dependencies.launchBrowser?.() ?? chromium.launch({ headless: true }));
  const results = [];
  const findings = [];
  const badcases = [];
  const packets = [];
  const challengeCases: EvalCase[] = [];
  const commit = await targetCommit(config.projectRoot);
  try {
    for (const [index, evalCase] of selection.cases.entries()) {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        const outcome = await runAdaptiveCase({
          page,
          provider,
          outputDir: config.outputDir,
          evalCase,
          productModel: foundation.model,
          existingCases: foundation.cases,
          startingUrl: startingUrlFor(evalCase, foundation.model, config.targetUrl),
          evalSetVersion: foundation.version,
          targetAppGitSha: commit,
          allowRemoteModel: true,
          allowScreenshotToProvider: input.allowScreenshot,
        });
        results.push(outcome.result);
        if (outcome.finding) findings.push(outcome.finding);
        if (outcome.badcase) badcases.push(outcome.badcase);
        challengeCases.push(...(outcome.passAnalysis?.challengeCandidates ?? []));
        packets.push(evidencePacketSchema.parse(JSON.parse(await readFile(outcome.agentRun.evidencePacketPath, 'utf8'))));
      } finally {
        await context.close();
      }
      await hooks.caseCompleted?.(index + 1, selection.cases.length, evalCase);
    }
  } finally {
    await browser.close();
  }

  const currentCases = await loadEvalSetCases(config.outputDir);
  const coverage = analyzeCoverage({ model: foundation.model, cases: currentCases, results, evidencePackets: packets });
  await saveCoverageMatrix(config.outputDir, coverage);
  const report = await buildAdaptiveEvaluationReport({ outputDir: config.outputDir, projectId: input.projectId, evaluationId: input.evaluationId, evaluationStatus: 'completed', selectedCases: selection.cases, results, packets, coverage, findings, badcases, challengeCases });
  const evaluationDirectory = resolve(config.outputDir, 'evaluations', input.evaluationId);
  await ensureDirectory(evaluationDirectory);
  await writeJsonAtomic(resolve(evaluationDirectory, 'report.json'), report);
  const result = { evaluationId: input.evaluationId, selectedCaseIds: selection.cases.map((item) => item.caseId), runIds: results.map((item) => item.runId), results, findings, badcases, coverage };
  return evaluationOrchestratorResultSchema.parse(result);
}
