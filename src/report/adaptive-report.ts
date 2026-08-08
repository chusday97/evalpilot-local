import { resolve } from 'node:path';
import { z } from 'zod';
import type { AdaptiveEvaluationReport, Badcase, CoverageMatrix, EvalCase, EvalCaseResult, EvidencePacket } from '../../types.js';
import { coverageGapSchema, coverageMatrixSchema, storageIdSchema } from '../eval-set/schemas.js';
import { evalCaseResultSchema, rootCauseHypothesisSchema } from '../judge/schemas.js';
import { interactionActionSchema } from '../schemas/ux-evaluation.js';
import { runVersionMetadataSchema } from '../test-agent/schemas.js';
import { writeTextAtomic } from '../utils/file-system.js';
import { writeSchemaJsonAtomic } from '../utils/schema-file.js';

export const adaptiveEvaluationReportSchema = z.object({
  reportId: storageIdSchema, projectId: storageIdSchema, generatedAt: z.iso.datetime(), executiveVerdict: z.enum(['can_continue', 'needs_attention', 'insufficient_evidence']), testedCaseIds: z.array(storageIdSchema), notTestedCaseIds: z.array(storageIdSchema), coverage: coverageMatrixSchema.nullable(), caseResults: z.array(evalCaseResultSchema),
  journeys: z.array(z.object({ runId: storageIdSchema, caseId: storageIdSchema, actions: z.array(interactionActionSchema), finalState: z.string() }).strict()),
  failures: z.array(z.object({ caseId: storageIdSchema, summary: z.string().min(1), severity: z.enum(['P0','P1','P2','P3']), evidenceRefs: z.array(z.string()) }).strict()),
  inconclusiveCases: z.array(z.object({ caseId: storageIdSchema, summary: z.string().min(1), failureSource: z.string().nullable() }).strict()), confirmedFacts: z.array(z.string().min(1)), rootCauseHypotheses: z.array(rootCauseHypothesisSchema), newBadcaseIds: z.array(storageIdSchema), newRegressionCaseIds: z.array(storageIdSchema), passingCoverageGaps: z.array(coverageGapSchema), newChallengeCaseIds: z.array(storageIdSchema), recommendedNextActions: z.array(z.string().min(1)), authenticityNotice: z.string().min(1), versionMetadata: z.array(runVersionMetadataSchema),
}).strict();

const lines = (values: string[], empty: string) => values.length ? values.map((value) => `- ${value}`).join('\n') : `- ${empty}`;

export function renderAdaptiveReportMarkdown(report: AdaptiveEvaluationReport): string {
  const coverage = report.coverage
    ? `评测资产覆盖 ${Math.round(report.coverage.assetCoverageRatio * 100)}%；实际运行覆盖 ${Math.round(report.coverage.executionCoverageRatio * 100)}%；已验证覆盖 ${Math.round(report.coverage.verifiedCoverageRatio * 100)}%。\n\n${report.coverage.gaps.map((gap) => `- ${gap.reason}`).join('\n') || '没有未验证覆盖缺口。'}`
    : '尚无覆盖矩阵';
  const results = report.caseResults.map((item) => `${item.caseId}: ${item.verdict.toUpperCase()} — ${item.semantic.summary}`);
  const journeys = report.journeys.map((item) => `${item.caseId}: ${item.actions.map((action) => action.outcome).join(' → ')}；最终：${item.finalState}`);
  return `# EvalPilot Adaptive Evaluation Report\n\n## 1. Executive verdict\n\n${report.executiveVerdict}\n\n## 2. What was tested\n\n${lines(report.testedCaseIds, '本轮没有可验证运行。')}\n\n## 3. What was not tested\n\n${lines(report.notTestedCaseIds, '本轮计划案例均有结果。')}\n\n## 4. Coverage matrix\n\n${coverage}\n\n## 5. Case results\n\n${lines(results, '没有案例结果。')}\n\n## 6. AI user journeys\n\n${lines(journeys, '没有可复核的动作旅程。')}\n\n## 7. Failures\n\n${lines(report.failures.map((item) => `${item.caseId} [${item.severity}]: ${item.summary}`), '没有确认的产品失败。')}\n\n## 8. Inconclusive cases\n\n${lines(report.inconclusiveCases.map((item) => `${item.caseId}: ${item.summary}`), '没有无法判断案例。')}\n\n## 9. Confirmed facts\n\n${lines(report.confirmedFacts, '没有新增确认事实。')}\n\n## 10. Root cause hypotheses\n\n${lines(report.rootCauseHypotheses.map((item) => `${item.hypothesis}（置信度 ${Math.round(item.confidence * 100)}%；验证：${item.howToVerify.join('；')}）`), '没有证据支持的根因假设。')}\n\n## 11. New badcases\n\n${lines(report.newBadcaseIds, '没有新增 Badcase。')}\n\n## 12. Regression additions\n\n${lines(report.newRegressionCaseIds, '没有新增 Regression。')}\n\n## 13. Passing-case coverage gaps\n\n${lines(report.passingCoverageGaps.map((item) => `${item.dimension}:${item.missingValue} — ${item.reason}`), '没有新增覆盖缺口。')}\n\n## 14. New challenge cases\n\n${lines(report.newChallengeCaseIds, '没有新增 Challenge 候选。')}\n\n## 15. Recommended next actions\n\n${lines(report.recommendedNextActions, '保持当前证据并在下一版本复跑。')}\n\n## 16. Authenticity / uncertainty notice\n\n${report.authenticityNotice}\n`;
}

export async function buildAdaptiveEvaluationReport(input: { outputDir: string; projectId: string; selectedCases: EvalCase[]; results: EvalCaseResult[]; packets: EvidencePacket[]; coverage: CoverageMatrix | null; badcases?: Badcase[]; regressionCases?: EvalCase[]; challengeCases?: EvalCase[]; generatedAt?: string }): Promise<AdaptiveEvaluationReport> {
  const generatedAt = input.generatedAt ?? new Date().toISOString(); const resultByCase = new Map(input.results.map((item) => [item.caseId, item])); const packetByRun = new Map(input.packets.map((item) => [item.runId, item]));
  const failures = input.results.filter((item) => item.verdict === 'fail' && item.failureSource === 'product').map((item) => ({ caseId: item.caseId, summary: item.semantic.summary, severity: item.severity!, evidenceRefs: item.semantic.evidenceRefs }));
  const inconclusiveCases = input.results.filter((item) => item.verdict === 'inconclusive').map((item) => ({ caseId: item.caseId, summary: item.semantic.summary, failureSource: item.failureSource }));
  const notTestedCaseIds = input.selectedCases.filter((item) => !resultByCase.has(item.caseId)).map((item) => item.caseId);
  const highGaps = input.coverage?.gaps.filter((item) => item.priority === 'critical' || item.priority === 'high') ?? [];
  const executiveVerdict = failures.length ? 'needs_attention' : inconclusiveCases.length || notTestedCaseIds.length || highGaps.length ? 'insufficient_evidence' : 'can_continue';
  const recommendedNextActions = failures.length ? ['先处理 P0/P1 产品失败，再用同一案例复测。'] : inconclusiveCases.length ? ['先恢复评测器或补齐前置条件，不要把无法判断当作产品通过。'] : highGaps.length ? ['优先运行高优先级 Coverage Gap 对应的 Challenge。'] : ['在下一版本复跑 Baseline 与 Regression。'];
  const report = adaptiveEvaluationReportSchema.parse({
    reportId: `adaptive-report-${generatedAt.replace(/[:.]/g, '-')}`, projectId: input.projectId, generatedAt, executiveVerdict,
    testedCaseIds: input.results.map((item) => item.caseId), notTestedCaseIds, coverage: input.coverage, caseResults: input.results,
    journeys: input.results.map((result) => { const packet = packetByRun.get(result.runId); return packet ? { runId: packet.runId, caseId: packet.caseId, actions: packet.actions, finalState: packet.finalState.visibleTextSummary } : null; }).filter((item): item is NonNullable<typeof item> => item !== null),
    failures, inconclusiveCases,
    confirmedFacts: [...new Set(input.results.flatMap((item) => item.semantic.confirmedFacts))], rootCauseHypotheses: input.results.flatMap((item) => item.semantic.hypotheses),
    newBadcaseIds: (input.badcases ?? []).map((item) => item.badcaseId), newRegressionCaseIds: (input.regressionCases ?? []).map((item) => item.caseId), passingCoverageGaps: input.coverage?.gaps ?? [], newChallengeCaseIds: (input.challengeCases ?? []).map((item) => item.caseId), recommendedNextActions,
    authenticityNotice: '本报告来自模拟 AI 用户、浏览器和 Judge 证据，不代表真实用户满意度、留存、转化或市场需求。确认事实与根因假设已分开；未知项必须继续验证。',
    versionMetadata: input.packets.map((item) => item.versions),
  });
  await writeSchemaJsonAtomic(resolve(input.outputDir, 'reports', 'latest-evaluation.json'), report, adaptiveEvaluationReportSchema);
  await writeTextAtomic(resolve(input.outputDir, 'reports', 'latest-evaluation.md'), renderAdaptiveReportMarkdown(report));
  return report;
}
