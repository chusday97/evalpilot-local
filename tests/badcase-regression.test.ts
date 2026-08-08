import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CandidateFinding, EvalCase, EvalCaseResult } from '../types.js';
import { badcaseFromProductFailure, createAndSaveBadcase, markBadcaseFixed } from '../src/badcase/badcase-service.js';
import { classifyEvalFailure } from '../src/badcase/classifier.js';
import { promoteFixedBadcaseToRegression } from '../src/badcase/regression-promoter.js';
import { loadBadcase } from '../src/badcase/badcase-store.js';
import { loadRegressionCases } from '../src/eval-set/regression-store.js';
import { saveFinding } from '../src/findings/finding-store.js';

const failedAt = '2026-08-01T12:00:00.000Z';
const fixedAt = '2026-08-01T13:00:00.000Z';

function sourceCase(): EvalCase {
  return {
    caseId: 'case-create', projectId: 'project-demo', setType: 'baseline', status: 'stable', origin: { type: 'human', note: 'fixture' }, capabilityId: 'cap-create', taskId: 'task-create', title: '创建项目', hypothesis: '提交后显示结果', persona: { personaId: 'user-new', name: '新用户', behaviorPolicy: ['只使用安全入口'] }, goal: '创建项目', knownInformation: {}, preconditions: [],
    oracle: { expectedOutcome: ['显示 Created'], mustObserve: ['Created'], mustNotObserve: ['Error'], businessRules: [], semanticRubric: ['用户确认完成'], deterministicAssertions: [], inconclusiveWhen: ['证据缺失'] }, coverageDimensions: [{ dimension: 'capability', value: 'cap-create' }], riskLevel: 'P1', generationReason: 'fixture', version: 1,
    stats: { passCount: 0, failCount: 1, inconclusiveCount: 0, latestResult: 'fail', latestRunId: 'run-failed', uniqueCoverageContribution: 1, lastExecutedAt: failedAt }, regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: failedAt, updatedAt: failedAt,
  };
}

function result(verdict: 'pass' | 'fail' | 'inconclusive', failureSource: EvalCaseResult['failureSource'], runId: string): EvalCaseResult {
  return {
    runId, caseId: 'case-create', verdict, failureSource, severity: verdict === 'fail' ? 'P1' : null,
    deterministic: { checks: [], hardFailure: verdict === 'fail', severity: verdict === 'fail' ? 'P1' : null, evidenceRefs: ['screenshots/final.png'] },
    semantic: { verdict, taskCompletion: verdict === 'pass' ? 'complete' : verdict === 'fail' ? 'failed' : 'unknown', summary: verdict === 'fail' ? '按钮点击后没有结果反馈' : verdict === 'pass' ? '创建结果可见' : '评测器输出无效', whatWorked: [], whatFailed: verdict === 'fail' ? ['点击后页面没有变化'] : [], whyItMatters: verdict === 'fail' ? ['用户无法确认项目是否创建'] : [], confirmedFacts: verdict === 'fail' ? ['点击已执行', '页面状态未变化'] : verdict === 'pass' ? ['Created 可见'] : [], hypotheses: verdict === 'fail' ? [{ hypothesis: '前端没有更新结果状态', confidence: 0.6, supportingEvidence: ['页面状态未变化'], contradictingEvidence: [], howToVerify: ['检查点击后的状态更新'] }] : [], unknowns: verdict === 'inconclusive' ? ['模型输出损坏'] : [], evidenceRefs: ['screenshots/final.png'], confidence: verdict === 'inconclusive' ? 0 : 0.9 },
    evidencePacketPath: `runs/${runId}/evidence-packet.json`, createdAt: verdict === 'pass' ? fixedAt : failedAt,
  };
}

function confirmedFinding(runId = 'run-failed'): CandidateFinding {
  return { findingId: `finding-${runId}`, projectId: 'project-demo', caseId: 'case-create', runId, title: '按钮点击后没有结果反馈', summary: '按钮点击后没有结果反馈', status: 'confirmed_product_failure', semanticConfidence: 0.9, deterministicSupport: true, independentEvidenceTypes: ['screenshot', 'deterministic_assertion'], confirmedFacts: ['点击已执行', '页面状态未变化'], hypotheses: [], unknowns: [], evidenceRefs: ['screenshots/final.png'], createdAt: failedAt, updatedAt: failedAt };
}

describe('Badcase and Regression lifecycle', () => {
  it('creates a Badcase only from confirmed product failure without inventing a root cause', () => {
    const failed = result('fail', 'product', 'run-failed');
    expect(classifyEvalFailure(sourceCase(), failed)).toMatchObject({ kind: 'product', category: 'interaction' });
    const badcase = badcaseFromProductFailure({ evalCase: sourceCase(), result: failed, finding: confirmedFinding(), createdAt: failedAt });
    expect(badcase).toMatchObject({ fixStatus: 'open', confirmedFacts: ['点击已执行', '页面状态未变化'], rootCauseHypotheses: [{ hypothesis: '前端没有更新结果状态', confidence: 0.6 }] });
  });

  it('keeps evaluator failures out of Product Badcases', () => {
    const evaluatorFailure = result('inconclusive', 'evaluator', 'run-evaluator');
    expect(classifyEvalFailure(sourceCase(), evaluatorFailure)).toMatchObject({ kind: 'evaluator', category: 'evaluator' });
    expect(() => badcaseFromProductFailure({ evalCase: sourceCase(), result: evaluatorFailure, finding: confirmedFinding('run-evaluator') })).toThrow(/不能创建 Product Badcase/);
  });

  it('promotes a fixed Badcase only after the same case passes and preserves lineage', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-regression-'));
    const finding = await saveFinding(outputDir, confirmedFinding());
    const created = await createAndSaveBadcase(outputDir, { evalCase: sourceCase(), result: result('fail', 'product', 'run-failed'), finding, createdAt: failedAt });
    await expect(promoteFixedBadcaseToRegression({ outputDir, badcase: created, sourceCase: sourceCase(), passingRetest: result('pass', null, 'run-passed'), fixedAt })).rejects.toThrow(/标记为 fixed/);
    const fixed = await markBadcaseFixed(outputDir, created, fixedAt);
    const promoted = await promoteFixedBadcaseToRegression({ outputDir, badcase: fixed, sourceCase: sourceCase(), passingRetest: result('pass', null, 'run-passed'), fixedAt, fixTaskId: 'fix-1' });
    expect(promoted.regressionCase).toMatchObject({ setType: 'regression', status: 'stable', regressionMetadata: { badcaseId: created.badcaseId, sourceRunId: 'run-failed', fixTaskId: 'fix-1' }, stats: { latestRunId: 'run-passed', latestResult: 'pass' } });
    expect(await loadRegressionCases(outputDir)).toHaveLength(1);
    expect(await loadBadcase(outputDir, created.badcaseId)).toMatchObject({ fixStatus: 'fixed', regressionCaseId: promoted.regressionCase.caseId });
  });

  it('rejects a passing result for a different case', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-regression-mismatch-'));
    const finding = await saveFinding(outputDir, confirmedFinding());
    const created = await createAndSaveBadcase(outputDir, { evalCase: sourceCase(), result: result('fail', 'product', 'run-failed'), finding, createdAt: failedAt });
    const fixed = await markBadcaseFixed(outputDir, created, fixedAt);
    await expect(promoteFixedBadcaseToRegression({ outputDir, badcase: fixed, sourceCase: sourceCase(), passingRetest: { ...result('pass', null, 'run-other'), caseId: 'case-other' }, fixedAt })).rejects.toThrow(/同一个原始案例/);
  });
});
