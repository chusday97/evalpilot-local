import { describe, expect, it } from 'vitest';
import type { EvalCase, EvalSetType, Severity } from '../types.js';
import { selectEvalSetCases } from '../src/eval-set/eval-set-runner.js';

const now = '2026-08-01T17:00:00.000Z';
function evalCase(caseId: string, setType: EvalSetType, capabilityId: string, riskLevel: Severity): EvalCase {
  return { caseId, projectId: 'project-demo', setType, status: 'stable', origin: setType === 'regression' ? { type: 'badcase', issueId: `issue-${caseId}`, badcaseId: `badcase-${caseId}`, firstFailedRunId: `run-${caseId}` } : { type: 'human', note: 'selection fixture' }, capabilityId, taskId: null, title: caseId, hypothesis: '用户完成任务', persona: { personaId: 'user-new', name: '新用户', behaviorPolicy: ['安全操作'] }, goal: '完成任务', knownInformation: {}, preconditions: [], oracle: { expectedOutcome: ['结果可见'], mustObserve: [], mustNotObserve: ['Error'], businessRules: [], semanticRubric: ['任务完成'], deterministicAssertions: [], inconclusiveWhen: ['证据不足'] }, coverageDimensions: [{ dimension: 'capability', value: capabilityId }], riskLevel, generationReason: 'fixture', version: 1, stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 1, lastExecutedAt: null }, regressionMetadata: setType === 'regression' ? { badcaseId: `badcase-${caseId}`, issueId: `issue-${caseId}`, firstFailedAt: now, fixedAt: now, originalFailure: '曾经失败', sourceRunId: `run-${caseId}`, fixTaskId: null } : null, retirementReason: null, needsHumanReview: false, createdAt: now, updatedAt: now };
}
const cases = [evalCase('case-baseline-a','baseline','cap-a','P1'), evalCase('case-baseline-b','baseline','cap-b','P1'), evalCase('case-regression-a','regression','cap-a','P2'), evalCase('case-challenge-a1','challenge','cap-a','P2'), evalCase('case-challenge-a2','challenge','cap-a','P3'), evalCase('case-explore-a','exploratory','cap-a','P3')];

describe('adaptive Eval Set selection', () => {
  it('always filters all set types by selected capability', () => {
    const selection = selectEvalSetCases({ cases, depth: 'full', capabilityIds: ['cap-a'] });
    expect(selection.cases.every((item) => item.capabilityId === 'cap-a')).toBe(true);
    expect(selection.cases.map((item) => item.setType)).toEqual(expect.arrayContaining(['baseline','regression','challenge','exploratory']));
    expect(selection.cases.some((item) => item.caseId === 'case-baseline-b')).toBe(false);
  });

  it('includes relevant Regression in core before a bounded Challenge budget', () => {
    const selection = selectEvalSetCases({ cases, depth: 'core', capabilityIds: ['cap-a'], challengeBudget: 1 });
    expect(selection.cases.some((item) => item.setType === 'regression')).toBe(true);
    expect(selection.counts.challenge).toBe(1);
    expect(selection.counts.exploratory).toBe(0);
  });

  it('keeps quick evaluation to P0/P1 Baseline and Regression', () => {
    const selection = selectEvalSetCases({ cases, depth: 'quick', capabilityIds: ['cap-a'] });
    expect(selection.cases.map((item) => item.caseId)).toEqual(['case-baseline-a']);
  });
});
