import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page } from 'playwright';
import type { AiProvider } from '../ai/provider.js';
import type { Badcase, EvalCase, EvalCaseResult, EvaluatorBadcase, PassAnalysis, ProductModel } from '../../types.js';
import type { SyntheticFileFixture } from '../scenario/file-fixture-resolver.js';
import type { AdaptiveExperienceAnalysis } from '../ux-evaluation/adaptive-experience-analyzer.js';
import { recordCaseResult } from '../eval-set/case-lifecycle.js';
import { analyzeCoverage } from '../eval-set/coverage-analyzer.js';
import { loadCoverageRunEvidence, saveCoverageMatrix } from '../eval-set/coverage-store.js';
import { saveEvalCase } from '../eval-set/eval-set-store.js';
import { analyzePassingCase } from '../eval-set/pass-analyzer.js';
import { judgeEvalCase } from '../judge/hybrid-judge.js';
import { evalCaseResultSchema } from '../judge/schemas.js';
import { triageEvalCaseFinding } from '../findings/finding-triage.js';
import { buildAdaptiveEvaluationReport } from '../report/adaptive-report.js';
import { runAiTestAgent } from '../test-agent/agent-runner.js';
import { evidencePacketSchema } from '../test-agent/schemas.js';
import { stabilizeFunctionalEntry } from '../test-agent/functional-entry-stabilization.js';
import { classifyEvaluatorFailure, evaluatorBadcaseFrom, evaluatorFailureResult } from '../evaluator-errors/classifier.js';
import { saveEvaluatorBadcase } from '../evaluator-errors/store.js';
import { analyzeAdaptiveExperience } from '../ux-evaluation/adaptive-experience-analyzer.js';
import { writeJsonAtomic } from '../utils/file-system.js';

export async function runAdaptiveCase(input: {
  page: Page;
  provider: AiProvider;
  outputDir: string;
  evalCase: EvalCase;
  productModel: ProductModel;
  existingCases: EvalCase[];
  startingUrl: string;
  evalSetVersion: number;
  targetAppGitSha?: string | null;
  allowRemoteModel?: boolean;
  allowScreenshotToProvider?: boolean;
  maxAgentSteps?: number;
  agentWaitTimeoutMs?: number;
  fileFixtures?: SyntheticFileFixture[];
  now?: () => Date;
}): Promise<{
  agentRun: Awaited<ReturnType<typeof runAiTestAgent>>;
  result: EvalCaseResult;
  finding: Awaited<ReturnType<typeof triageEvalCaseFinding>>['finding'];
  badcase: Badcase | null;
  evaluatorBadcase: EvaluatorBadcase | null;
  passAnalysis: PassAnalysis | null;
  experience: AdaptiveExperienceAnalysis;
  report: Awaited<ReturnType<typeof buildAdaptiveEvaluationReport>>;
}> {
  // Functional evaluation starts only after evaluator-managed SPA hydration settles. This is
  // deliberately not shared with Blind Experience: Blind should observe genuine loading and
  // discoverability friction, while Functional should answer whether the prepared task works.
  const entryStabilization = await stabilizeFunctionalEntry(input.page, input.startingUrl);
  const agentRun = await runAiTestAgent(input.page, input.evalCase, input.provider, {
    outputDir: input.outputDir,
    startingUrl: entryStabilization.finalUrl,
    mode: 'task',
    maxSteps: input.maxAgentSteps,
    waitTimeoutMs: input.agentWaitTimeoutMs,
    targetAppCommit: input.targetAppGitSha ?? null,
    productModelVersion: input.productModel.version,
    evalSetVersion: input.evalSetVersion,
    judgeModel: input.provider.info.model,
    allowRemoteModel: input.allowRemoteModel,
    allowScreenshotToProvider: input.allowScreenshotToProvider,
    fileFixtures: input.fileFixtures,
    now: input.now,
  });
  await writeJsonAtomic(resolve(input.outputDir, 'runs', agentRun.runId, 'functional-entry-stabilization.json'), entryStabilization);
  const packet = evidencePacketSchema.parse(JSON.parse(await readFile(agentRun.evidencePacketPath, 'utf8')));
  const rawJudgedResult = await judgeEvalCase({ outputDir: input.outputDir, evalCase: input.evalCase, packet, provider: input.provider, allowRemoteModel: input.allowRemoteModel, createdAt: agentRun.completedAt });
  const safetyGatedResult = agentRun.status === 'blocked_by_safety'
    ? evalCaseResultSchema.parse({ ...rawJudgedResult, verdict: 'inconclusive', failureSource: 'evaluator', severity: null, semantic: { ...rawJudgedResult.semantic, verdict: 'inconclusive', taskCompletion: 'unknown', summary: '安全策略阻止了危险操作，本次不能据此判断产品通过或失败。', whatFailed: [], confirmedFacts: ['Agent 已阻止危险操作'], hypotheses: [], unknowns: ['需要人工确认是否应在受控环境测试该操作'], confidence: 1 } })
    : rawJudgedResult;
  const evaluatorFailure = classifyEvaluatorFailure({ agentRun, packet, result: safetyGatedResult });
  const judgedResult = evaluatorFailure ? evaluatorFailureResult(safetyGatedResult, evaluatorFailure) : safetyGatedResult;
  const evaluatorBadcase = evaluatorFailure
    ? await saveEvaluatorBadcase(input.outputDir, evaluatorBadcaseFrom({ evalCase: input.evalCase, agentRun, packet, classification: evaluatorFailure }))
    : null;
  const triage = await triageEvalCaseFinding({ outputDir: input.outputDir, evalCase: input.evalCase, result: judgedResult, packet, createdAt: agentRun.completedAt });
  const result = triage.result;

  // Functional verdict stays authoritative for bugs. Experience analysis is a sidecar that
  // only emits non-blocking friction when the functional task passed. This prevents a dead
  // button or broken save from being softened into a UX recommendation.
  const experience = analyzeAdaptiveExperience({
    evalCase: input.evalCase,
    result,
    packet,
    decisions: agentRun.decisions,
  });
  await writeJsonAtomic(resolve(input.outputDir, 'runs', agentRun.runId, 'experience-analysis.json'), experience);

  const updatedCase = recordCaseResult(input.evalCase, result); await saveEvalCase(input.outputDir, updatedCase);
  const badcase: Badcase | null = triage.badcase; let passAnalysis: PassAnalysis | null = null;
  if (result.verdict === 'pass' && result.failureSource === null) {
    passAnalysis = analyzePassingCase({ evalCase: updatedCase, result, evidencePacket: packet, model: input.productModel, existingCases: input.existingCases.map((item) => item.caseId === updatedCase.caseId ? updatedCase : item), generatedAt: agentRun.completedAt });
    for (const candidate of passAnalysis.challengeCandidates) await saveEvalCase(input.outputDir, candidate);
  }
  const runEvidence = await loadCoverageRunEvidence(input.outputDir);
  const coverageCases = [...new Map([...input.existingCases.map((item) => item.caseId === updatedCase.caseId ? updatedCase : item), ...(passAnalysis?.challengeCandidates ?? [])].map((item) => [item.caseId, item])).values()];
  const coverage = analyzeCoverage({ model: input.productModel, cases: coverageCases, ...runEvidence, generatedAt: agentRun.completedAt });
  if (passAnalysis) {
    coverage.gaps = coverage.gaps.map((gap) => ({
      ...gap,
      candidateCaseIds: passAnalysis!.challengeCandidates
        .filter((candidate) => candidate.origin.type === 'generated_from_coverage_gap' && candidate.origin.gapId === gap.gapId)
        .map((candidate) => candidate.caseId),
    }));
  }
  await saveCoverageMatrix(input.outputDir, coverage);
  const report = await buildAdaptiveEvaluationReport({ outputDir: input.outputDir, projectId: input.evalCase.projectId, evaluationId: `evaluation-${result.runId}`, evaluationStatus: 'completed', selectedCases: [input.evalCase], results: [result], packets: [packet], coverage, findings: triage.finding ? [triage.finding] : [], badcases: badcase ? [badcase] : [], challengeCases: passAnalysis?.challengeCandidates ?? [], generatedAt: agentRun.completedAt });
  return { agentRun, result, finding: triage.finding, badcase, evaluatorBadcase, passAnalysis, experience, report };
}
