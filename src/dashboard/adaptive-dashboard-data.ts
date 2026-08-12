import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AdaptiveRunSummary, AiTestAgentRun, Badcase, CandidateFinding, CoverageMatrix, EvalCase, EvalSetDashboardSummary, EvalSetType, EvidencePacket, ProductModel } from '../../types.js';
import type { AiProvider } from '../ai/provider.js';
import { listProductModelVersions, loadProductModel } from '../product-model/product-model-store.js';
import { loadLatestCoverageMatrix } from '../eval-set/coverage-store.js';
import { evalSetManifestPath, loadEvalCase, loadEvalSetCases, loadEvalSetManifest } from '../eval-set/eval-set-store.js';
import { listBadcases, loadBadcase } from '../badcase/badcase-store.js';
import { loadEvalCaseResult } from '../judge/eval-result-store.js';
import { listFindings, loadFinding } from '../findings/finding-store.js';
import { pathExists } from '../utils/file-system.js';
import { generateEvaluationFoundation } from '../evaluation/evaluation-foundation.js';
import { evidencePacketSchema } from '../test-agent/schemas.js';

const emptyCounts: Record<EvalSetType, number> = { baseline: 0, regression: 0, challenge: 0, exploratory: 0 };

type AdaptiveRunDiagnosticSummary = AdaptiveRunSummary & {
  evidenceComplete: boolean;
  evidenceMissing: string[];
  deterministicChecks: Awaited<ReturnType<typeof loadEvalCaseResult>>['deterministic']['checks'];
  deterministicHardFailure: boolean;
  semanticVerdict: Awaited<ReturnType<typeof loadEvalCaseResult>>['semantic']['verdict'];
  semanticUnknowns: string[];
  finalState: EvidencePacket['finalState'] | null;
  agentStatus: AiTestAgentRun['status'] | null;
  agentError: string | null;
  lastDecision: AiTestAgentRun['decisions'][number] | null;
  lastActionResult: AiTestAgentRun['actionResults'][number] | null;
};

export async function latestProductModel(outputDir: string): Promise<ProductModel | null> {
  const versions = await listProductModelVersions(outputDir);
  const version = versions.at(-1);
  return version ? loadProductModel(outputDir, version) : null;
}

export async function evalSetSummary(outputDir: string): Promise<EvalSetDashboardSummary> {
  const model = await latestProductModel(outputDir);
  if (!await pathExists(evalSetManifestPath(outputDir))) return { manifest: null, counts: { ...emptyCounts }, retiredCount: 0, latestProductModelVersion: model?.version ?? null };
  const [manifest, cases] = await Promise.all([loadEvalSetManifest(outputDir), loadEvalSetCases(outputDir)]);
  const counts = { ...emptyCounts };
  for (const evalCase of cases) counts[evalCase.setType] += 1;
  return { manifest, counts, retiredCount: cases.filter((item) => item.status === 'retired').length, latestProductModelVersion: model?.version ?? null };
}

export async function listAdaptiveCases(outputDir: string): Promise<EvalCase[]> {
  return await pathExists(evalSetManifestPath(outputDir)) ? loadEvalSetCases(outputDir) : [];
}

export async function findAdaptiveCase(outputDir: string, caseId: string): Promise<EvalCase | null> {
  const manifest = await pathExists(evalSetManifestPath(outputDir)) ? await loadEvalSetManifest(outputDir) : null;
  const reference = manifest?.cases.find((item) => item.caseId === caseId);
  return reference ? loadEvalCase(outputDir, reference.setType, reference.caseId) : null;
}

export async function latestCoverage(outputDir: string): Promise<CoverageMatrix | null> {
  return await pathExists(resolve(outputDir, 'coverage', 'latest.json')) ? loadLatestCoverageMatrix(outputDir) : null;
}

export async function projectBadcases(outputDir: string): Promise<Badcase[]> {
  return listBadcases(outputDir);
}

export async function projectBadcase(outputDir: string, badcaseId: string): Promise<Badcase | null> {
  return await pathExists(resolve(outputDir, 'badcases', `${badcaseId}.json`)) ? loadBadcase(outputDir, badcaseId) : null;
}

export async function projectFindings(outputDir: string): Promise<CandidateFinding[]> {
  return listFindings(outputDir);
}

export async function projectFinding(outputDir: string, findingId: string): Promise<CandidateFinding | null> {
  const canonical = resolve(outputDir, 'findings', `${findingId}.json`);
  const legacy = resolve(outputDir, 'findings', 'v1', `${findingId}.json`);
  return await pathExists(canonical) || await pathExists(legacy) ? loadFinding(outputDir, findingId) : null;
}

export async function regressionCases(outputDir: string): Promise<EvalCase[]> {
  return (await listAdaptiveCases(outputDir)).filter((item) => item.setType === 'regression');
}

export async function listAdaptiveRuns(outputDir: string): Promise<AdaptiveRunSummary[]> {
  const directory = resolve(outputDir, 'runs');
  if (!await pathExists(directory)) return [];
  const cases = await listAdaptiveCases(outputDir);
  const caseById = new Map(cases.map((item) => [item.caseId, item]));
  const summaries: AdaptiveRunSummary[] = [];
  for (const runId of (await readdir(directory)).sort().reverse()) {
    if (!await pathExists(resolve(directory, runId, 'result.json'))) continue;
    const result = await loadEvalCaseResult(outputDir, runId);
    const evalCase = caseById.get(result.caseId);
    const packetPath = resolve(directory, runId, 'evidence-packet.json');
    const packet = await pathExists(packetPath)
      ? evidencePacketSchema.parse(JSON.parse(await readFile(packetPath, 'utf8')))
      : null;
    const agentRunPath = resolve(directory, runId, 'agent-run.json');
    const agentRun = await pathExists(agentRunPath)
      ? JSON.parse(await readFile(agentRunPath, 'utf8')) as AiTestAgentRun
      : null;
    const summary: AdaptiveRunDiagnosticSummary = {
      runId,
      caseId: result.caseId,
      caseTitle: evalCase?.title ?? null,
      setType: evalCase?.setType ?? null,
      verdict: result.verdict,
      failureSource: result.failureSource,
      severity: result.severity,
      summary: result.semantic.summary,
      createdAt: result.createdAt,
      evidenceComplete: packet?.evidenceCompleteness.complete ?? false,
      evidenceMissing: packet?.evidenceCompleteness.missing ?? ['缺少 Evidence Packet。'],
      deterministicChecks: result.deterministic.checks,
      deterministicHardFailure: result.deterministic.hardFailure,
      semanticVerdict: result.semantic.verdict,
      semanticUnknowns: result.semantic.unknowns,
      finalState: packet?.finalState ?? null,
      agentStatus: agentRun?.status ?? null,
      agentError: agentRun?.error ?? null,
      lastDecision: agentRun?.decisions.at(-1) ?? null,
      lastActionResult: agentRun?.actionResults.at(-1) ?? null,
    };
    summaries.push(summary);
  }
  return summaries;
}

export async function generateAdaptiveFoundation(input: { projectId: string; outputDir: string; provider?: AiProvider; allowRemoteModel?: boolean; generatedAt?: string }) {
  const foundation = await generateEvaluationFoundation(input);
  return { ...foundation, summary: await evalSetSummary(input.outputDir) };
}
