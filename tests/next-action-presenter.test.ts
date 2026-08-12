import { describe, expect, it } from 'vitest';
import type { EvaluationNextAction } from '../types.js';
import { presentNextAction } from '../dashboard/src/next-action-presenter.js';

function action(overrides: Partial<EvaluationNextAction> = {}): EvaluationNextAction {
  return {
    type: 'provide_human_input',
    title: '先准备测试登录态',
    explanation: '这个任务需要本地 Auth Fixture。',
    targetCaseIds: ['case-auth'],
    targetFindingIds: [],
    targetBadcaseIds: [],
    primaryCta: { label: '查看需要登录态的案例', route: '/eval-set?caseId=case-auth' },
    secondaryCtas: [],
    ...overrides,
  };
}

describe('next action presenter', () => {
  it('explains a prerequisite blocker as a non-product-failure decision', () => {
    const presented = presentNextAction(action());
    expect(presented.eyebrow).toContain('前置条件');
    expect(presented.whatHappened).toContain('没有形成可用于判断产品失败');
    expect(presented.now).toBe('先准备测试登录态');
    expect(presented.doNot).toContain('不要生成代码修复任务');
    expect(presented.tone).toBe('warn');
  });

  it('tells the user to wait instead of treating a progressing task as failure', () => {
    const presented = presentNextAction(action({ type: 'wait_and_resume', title: '等待当前任务完成' }));
    expect(presented.whatHappened).toContain('等待或处理中');
    expect(presented.doNot).toContain('不要因为等待时间长');
  });

  it('allows fix semantics only after a confirmed product failure', () => {
    const presented = presentNextAction(action({ type: 'create_fix_task', title: '为已确认问题创建修复任务', targetFindingIds: ['finding-a'] }));
    expect(presented.eyebrow).toBe('已确认产品问题');
    expect(presented.doNot).toBeNull();
    expect(presented.tone).toBe('danger');
  });

  it('keeps candidate findings out of code repair', () => {
    const presented = presentNextAction(action({ type: 'review_candidate_finding', title: '先复核候选发现', targetFindingIds: ['finding-a'] }));
    expect(presented.whatHappened).toContain('还没有达到可直接修复');
    expect(presented.doNot).toContain('确认之前不要创建代码修复任务');
  });
});
