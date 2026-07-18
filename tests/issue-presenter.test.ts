import { describe, expect, it } from 'vitest';
import type { UxIssue } from '../types.js';
import { presentIssue } from '../src/dashboard/issue-presenter.js';

function legacyIssue(): UxIssue {
  return {
    issueId: 'legacy-1',
    type: 'journey_breakpoint',
    severity: 'P1',
    featureId: '首次推荐',
    personaId: 'persona-new-user',
    caseId: 'case-1',
    userGoal: '获得推荐结果',
    idealPath: ['开始', '看到结果'],
    actualPath: ['开始', '没有反馈'],
    shortestReasonablePath: ['开始', '看到结果'],
    failureOrAbandonmentPoint: '提交后没有结果反馈',
    metrics: {} as UxIssue['metrics'],
    evidence: ['trace.zip', 'failure.png'],
    recommendation: '补充明确结果反馈',
    protectedSafetySteps: [],
    confidence: 'medium',
    needsHumanReview: false,
    addedToRegression: false,
  };
}

describe('issue presenter compatibility', () => {
  it('does not invent a location or root cause for legacy issues', () => {
    const issue = presentIssue(legacyIssue());

    expect(issue.location).toBeNull();
    expect(issue.causeHypothesis).toBeNull();
    expect(issue.needsHumanReview).toBe(true);
    expect(issue.evidenceItems).toHaveLength(2);
    expect(issue.evidenceItems?.every((item) => item.relatedStepIndex === null)).toBe(true);
    expect(issue.evidenceItems?.[0]?.observation).toContain('未记录它对应的具体操作步骤');
  });

  it('keeps verified structured location and resolution steps intact', () => {
    const issue = presentIssue({
      ...legacyIssue(),
      location: { page: '/recommend', stepIndex: 1, stepLabel: '提交信息', target: '生成推荐按钮', sourceFile: null },
      causeHypothesis: '页面可能没有渲染成功状态。',
      resolutionSteps: ['提交后显示明确的完成状态。'],
      verificationSteps: ['点击后 1 秒内显示结果。'],
    });

    expect(issue.location?.target).toBe('生成推荐按钮');
    expect(issue.resolutionSteps).toEqual(['提交后显示明确的完成状态。']);
    expect(issue.verificationSteps).toEqual(['点击后 1 秒内显示结果。']);
  });
});
