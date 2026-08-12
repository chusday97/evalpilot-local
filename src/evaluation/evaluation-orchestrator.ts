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
import { compileExecutableScenarios, planScenarioExecution, scenarioBlockerSummary } from '../scenario/scenario-compiler.js';
import { resolveScenarioSetups } from '../scenario/setup-resolver.js';
import { runAutoSetup, type AutoSetupExecutionResult } from '../scenario/setup-runner.js';
import { evidencePacketSchema } from '../test-agent/schemas.js';
import { EvalPilotError } from '../utils/errors.js';
import { ensureDirectory, pathExists, writeJsonAtomic } from '../utils/file-system.js';
import { configForProject } from '../projects/project-registry.js';
import { runAdaptiveCase } from './adaptive-evaluation-service.js';
import { evaluationSourceFingerprint, generateEvaluationFoundation, loadEvaluationFoundationState, saveEvaluationFoundationState } from './evaluation-foundation.js';
import { foundationQualityFromGeneration, foundationQualityMessage, loadFoundationQualityState, saveFoundationQualityState, shouldRegenerateFoundation, type FoundationQualityState } from './foundation-quality.js';
import { evaluationOrchestratorInputSchema, evaluationOrchestratorResultSchema } from './schemas.js';
import { selectEvaluationCases } from './evaluation-selector.js';

const execFileAsync = promisify(execFile);

interface OrchestratorHooks {
  prepared?: (selection: EvalSetSelection, model: ProductModel, quality: FoundationQualityState) => Promise<void> | void;
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

async function ensureFoundation(projectId: string, outputDir: string, provider: AiProvider): Promise<{ model: ProductModel; cases: EvalCase[]; version: number; quality: FoundationQualityState }> {
  const versions = await listProductModelVersions(outputDir);
  const hasEvalSet = await pathExists(evalSetManifestPath(outputDir));
  const sourceFingerprint = await evaluationSourceFingerprint(outputDir);
  const [state, persistedQuality] = await Promise.all([
    loadEvaluationFoundationState(outputDir),
    loadFoundationQualityState(outputDir),
  ]);
  const regenerate = shouldRegenerateFoundation({
    hasProductModel: versions.length > 0,
    hasEvalSet,
    sourceFingerprint,
    persistedFingerprint: state?.sourceFingerprint ?? null,
    qualityState: persistedQuality,
    providerId: provider.info.providerId,
    model: provider.info.model,
  });
  let quality = persistedQuality;
  if (regenerate) {
    const generatedAt = new Date().toISOString();
    const generated = await generateEvaluationFoundation({ projectId, outputDir, provider, allowRemoteModel: true, generatedAt });
    quality = foundationQualityFromGeneration({
      sourceFingerprint,
      generationMode: generated.generationMode,
      oracleFallbackCount: generated.oracleFallbackCount,
      warnings: generated.warnings,
      provider,
      generatedAt,
    });
    await saveFoundationQualityState(outputDir, quality);
  }

  const currentVersions = await listProductModelVersions(outputDir);
  const modelVersion = currentVersions.at(-1);
  if (!modelVersion) throw new EvalPilotError('产品理解没有成功生成，请检查扫描证据后重试。', 'PRODUCT_MODEL_REQUIRED');
  const [model, cases, manifest] = await Promise.all([
    loadProductModel(outputDir, modelVersion),
    loadEvalSetCases(outputDir),
    loadEvalSetManifest(outputDir),
  ]);
  if (!quality || quality.sourceFingerprint !== sourceFingerprint) {
    throw new EvalPilotError('产品理解质量状态缺失，已停止使用无法确认来源的评测案例。', 'PRODUCT_MODEL_REQUIRED');
  }
  await saveEvaluationFoundationState(outputDir, { schemaVersion: 1, sourceFingerprint, productModelVersion: model.version, evalSetVersion: manifest.version, generatedAt: quality.generatedAt });
  return { model, cases, version: manifest.version, quality };
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
  const evaluationDirectory = resolve(config.outputDir, 'evaluations', input.evaluationId);
  await ensureDirectory(evaluationDirectory);
  await writeJsonAtomic(resolve(evaluationDirectory, 'foundation-quality.json'), foundation.quality);
  if (foundation.quality.quality === 'degraded') {
    throw new EvalPilotError(foundationQualityMessage(foundation.quality), 'PRODUCT_MODEL_REQUIRED');
  }

  const selection = selectEvaluationCases({ model: foundation.model, cases: foundation.cases, depth: input.depth, capabilityIds: input.capabilityIds });
  if (!selection.cases.length) throw new EvalPilotError('所选功能没有可运行的评测案例。请重新整理案例或调整功能范围。', 'EVALUATION_CASE_NOT_FOUND');

  const scenarioGeneratedAt = new Date().toISOString();
  const scenarios = compileExecutableScenarios({ cases: selection.cases, productModel: foundation.model, targetUrl: config.targetUrl, generatedAt: scenarioGeneratedAt });
  const executionPlan = planScenarioExecution(scenarios);
  const setupResolutions = resolveScenarioSetups({ scenarios, cases: selection.cases, productModel: foundation.model, targetUrl: config.targetUrl, generatedAt: scenarioGeneratedAt });
  const setupPlans = setupResolutions.flatMap((resolution) => resolution.status === 'auto_setup' && resolution.plan ? [resolution.plan] : []);
  const setupPlanByCaseId = new Map(setupPlans.map((plan) => [plan.targetCaseId, plan]));
  const autoSetupCaseIds = setupPlans.map((plan) => plan.targetCaseId);
  const effectiveReadyCaseIds = [...new Set([...executionPlan.readyCaseIds, ...autoSetupCaseIds])];
  const effectiveReadyCaseIdSet = new Set(effectiveReadyCaseIds);
  const effectiveBlockedScenarios = scenarios.filter((scenario) => !effectiveReadyCaseIdSet.has(scenario.caseId));
  const effectiveBlockedCaseIds = effectiveBlockedScenarios.map((scenario) => scenario.caseId);
  await writeJsonAtomic(resolve(evaluationDirectory, 'scenario-preflight.json'), {
    schemaVersion: 2,
    evaluationId: input.evaluationId,
    generatedAt: scenarioGeneratedAt,
    readyCaseIds: effectiveReadyCaseIds,
    blockedCaseIds: effectiveBlockedCaseIds,
    directReadyCaseIds: executionPlan.readyCaseIds,
    autoSetupCaseIds,
    setupResolutions,
    scenarios,
  });
  if (executionPlan.allBlocked && autoSetupCaseIds.length === 0) {
    const detail = scenarioBlockerSummary(effectiveBlockedScenarios);
    const setupDetail = setupResolutions.filter((item) => item.status === 'blocked').map((item) => `${item.caseId}: ${item.reason}`).join(' | ');
    throw new EvalPilotError(`所选评测任务当前都不具备安全执行条件。EvalPilot 已在启动浏览器前停止：${[detail, setupDetail].filter(Boolean).join(' | ')}`, 'EVALUATION_SCENARIO_NOT_READY');
  }

  await hooks.prepared?.(selection, foundation.model, foundation.quality);
  const scenarioByCaseId = new Map(scenarios.map((scenario) => [scenario.caseId, scenario]));
  const runnableCaseIds = new Set(effectiveReadyCaseIds);
  const runnableCases = selection.cases.filter((evalCase) => runnableCaseIds.has(evalCase.caseId));
  const browser = await (dependencies.launchBrowser?.() ?? chromium.launch({ headless: true }));
  const results = [];
  const findings = [];
  const badcases = [];
  const packets = [];
  const challengeCases: EvalCase[] = [];
  const setupExecutions: AutoSetupExecutionResult[] = [];
  const setupExecutionDirectory = resolve(evaluationDirectory, 'setup-executions');
  if (setupPlans.length) await ensureDirectory(setupExecutionDirectory);
  const commit = await targetCommit(config.projectRoot);
  try {
    for (const [index, evalCase] of runnableCases.entries()) {
      const scenario = scenarioByCaseId.get(evalCase.caseId);
      const setupPlan = setupPlanByCaseId.get(evalCase.caseId) ?? null;
      if (!scenario || (scenario.readiness !== 'ready' && !setupPlan)) throw new EvalPilotError(`案例“${evalCase.title}”未通过 Scenario Preflight。`, 'EVALUATION_SCENARIO_NOT_READY');
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        let setupPassed = true;
        if (setupPlan) {
          const setupExecution = await runAutoSetup({
            page,
            provider,
            outputDir: config.outputDir,
            plan: setupPlan,
            productModel: foundation.model,
            evalSetVersion: foundation.version,
            targetAppGitSha: commit,
            allowRemoteModel: true,
            allowScreenshotToProvider: input.allowScreenshot,
          });
          setupExecutions.push(setupExecution);
          await writeJsonAtomic(resolve(setupExecutionDirectory, `${evalCase.caseId}.json`), setupExecution);
          setupPassed = setupExecution.status === 'passed';
        }
        if (setupPassed) {
          const outcome = await runAdaptiveCase({
            page,
            provider,
            outputDir: config.outputDir,
            evalCase,
            productModel: foundation.model,
            existingCases: foundation.cases,
            startingUrl: scenario.startingUrl,
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
        }
      } finally {
        await context.close();
      }
      await hooks.caseCompleted?.(index + 1, runnableCases.length, evalCase);
    }
  } finally {
    await browser.close();
  }

  if (setupExecutions.length) {
    await writeJsonAtomic(resolve(evaluationDirectory, 'setup-summary.json'), {
      schemaVersion: 1,
      evaluationId: input.evaluationId,
      generatedAt: new Date().toISOString(),
      executions: setupExecutions,
    });
  }
  const currentCases = await loadEvalSetCases(config.outputDir);
  const coverage = analyzeCoverage({ model: foundation.model, cases: currentCases, results, evidencePackets: packets });
  await saveCoverageMatrix(config.outputDir, coverage);
  const report = await buildAdaptiveEvaluationReport({ outputDir: config.outputDir, projectId: input.projectId, evaluationId: input.evaluationId, evaluationStatus: 'completed', selectedCases: selection.cases, results, packets, coverage, findings, badcases, challengeCases });
  await writeJsonAtomic(resolve(evaluationDirectory, 'report.json'), report);
  const result = { evaluationId: input.evaluationId, selectedCaseIds: selection.cases.map((item) => item.caseId), runIds: results.map((item) => item.runId), results, findings, badcases, coverage };
  return evaluationOrchestratorResultSchema.parse(result);
}
