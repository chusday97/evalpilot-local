import { readFile } from 'node:fs/promises';
import type { Page } from 'playwright';
import type { AiProvider } from '../ai/provider.js';
import type { Badcase, EvalCase, EvalCaseResult, PassAnalysis, ProductModel } from '../../types.js';
import { createAndSaveBadcase } from '../badcase/badcase-service.js';
import { recordCaseResult } from '../eval-set/case-lifecycle.js';
import { analyzeCoverage } from '../eval-set/coverage-analyzer.js';
import { saveCoverageMatrix } from '../eval-set/coverage-store.js';
import { saveEvalCase } from '../eval-set/eval-set-store.js';
import { analyzePassingCase } from '../eval-set/pass-analyzer.js';
import { judgeEvalCase } from '../judge/hybrid-judge.js';
import { buildAdaptiveEvaluationReport } from '../report/adaptive-report.js';
import { runAiTestAgent } from '../test-agent/agent-runner.js';
import { evidencePacketSchema } from '../test-agent/schemas.js';

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
  now?: () => Date;
}): Promise<{ agentRun: Awaited<ReturnType<typeof runAiTestAgent>>; result: EvalCaseResult; badcase: Badcase | null; passAnalysis: PassAnalysis | null; report: Awaited<ReturnType<typeof buildAdaptiveEvaluationReport>> }> {
  const agentRun = await runAiTestAgent(input.page, input.evalCase, input.provider, { outputDir: input.outputDir, startingUrl: input.startingUrl, mode: 'task', targetAppCommit: input.targetAppGitSha ?? null, productModelVersion: input.productModel.version, evalSetVersion: input.evalSetVersion, judgeModel: input.provider.info.model, allowRemoteModel: input.allowRemoteModel, allowScreenshotToProvider: input.allowScreenshotToProvider, now: input.now });
  const packet = evidencePacketSchema.parse(JSON.parse(await readFile(agentRun.evidencePacketPath, 'utf8')));
  const result = await judgeEvalCase({ outputDir: input.outputDir, evalCase: input.evalCase, packet, provider: input.provider, allowRemoteModel: input.allowRemoteModel, createdAt: agentRun.completedAt });
  const updatedCase = recordCaseResult(input.evalCase, result); await saveEvalCase(input.outputDir, updatedCase);
  let badcase: Badcase | null = null; let passAnalysis: PassAnalysis | null = null;
  if (result.verdict === 'fail' && result.failureSource === 'product') badcase = await createAndSaveBadcase(input.outputDir, { evalCase: input.evalCase, result, createdAt: agentRun.completedAt });
  if (result.verdict === 'pass' && result.failureSource === null) {
    passAnalysis = analyzePassingCase({ evalCase: updatedCase, result, model: input.productModel, existingCases: input.existingCases.map((item) => item.caseId === updatedCase.caseId ? updatedCase : item), generatedAt: agentRun.completedAt });
    for (const candidate of passAnalysis.challengeCandidates) await saveEvalCase(input.outputDir, candidate);
  }
  const coverage = analyzeCoverage(input.productModel, input.existingCases.map((item) => item.caseId === updatedCase.caseId ? updatedCase : item), agentRun.completedAt);
  if (passAnalysis) {
    coverage.gaps = coverage.gaps.map((gap) => ({
      ...gap,
      candidateCaseIds: passAnalysis!.challengeCandidates
        .filter((candidate) => candidate.origin.type === 'generated_from_coverage_gap' && candidate.origin.gapId === gap.gapId)
        .map((candidate) => candidate.caseId),
    }));
  }
  await saveCoverageMatrix(input.outputDir, coverage);
  const report = await buildAdaptiveEvaluationReport({ outputDir: input.outputDir, projectId: input.evalCase.projectId, selectedCases: [input.evalCase], results: [result], packets: [packet], coverage, badcases: badcase ? [badcase] : [], challengeCases: passAnalysis?.challengeCandidates ?? [], generatedAt: agentRun.completedAt });
  return { agentRun, result, badcase, passAnalysis, report };
}
