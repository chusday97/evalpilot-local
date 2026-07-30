import { describe, expect, it } from 'vitest';
import {
  chooseSemanticTarget,
  evaluateEvidenceConditions,
  evaluateVisibleConditions,
  hasObservablePageChange,
} from '../src/ux-evaluation/semantic-explorer.js';

describe('deterministic semantic explorer', () => {
  it('chooses a goal-relevant safe entry without receiving a selector or path', () => {
    const target = chooseSemanticTarget([
      { index: 0, kind: 'button', label: '查看帮助', disabled: false },
      { index: 1, kind: 'button', label: '开始智能推荐', disabled: false },
      { index: 2, kind: 'button', label: '删除全部数据', disabled: false },
    ], '获得推荐并理解推荐理由', new Set());
    expect(target).toMatchObject({ index: 1, label: '开始智能推荐' });
    expect(target).not.toHaveProperty('selector');
  });

  it('never selects a destructive action even when it overlaps the goal', () => {
    const target = chooseSemanticTarget([
      { index: 0, kind: 'button', label: '删除推荐记录', disabled: false },
      { index: 1, kind: 'link', label: '推荐记录说明', disabled: false },
    ], '查看推荐记录', new Set());
    expect(target?.index).toBe(1);
  });

  it('uses a visible safe recovery action instead of abandoning on an error page', () => {
    const target = chooseSemanticTarget([
      { index: 0, kind: 'button', label: '重新尝试', disabled: false },
      { index: 1, kind: 'button', label: '复制诊断信息', disabled: false },
    ], '完成首页的主要任务', new Set());
    expect(target).toMatchObject({ index: 0, label: '重新尝试' });
  });

  it('only marks directly visible conditions as satisfied', () => {
    const result = evaluateVisibleConditions('推荐结果已生成。你可以保存或修改。', [
      '推荐结果已生成',
      '可以保存或修改',
      '推荐依据清晰可见',
    ]);
    expect(result.satisfied).toEqual(['推荐结果已生成', '可以保存或修改']);
    expect(result.missing).toEqual(['推荐依据清晰可见']);
    expect(result.complete).toBe(false);
  });

  it('uses runtime evidence for generic entry-page conditions instead of requiring test prose on the page', () => {
    const result = evaluateEvidenceConditions('赛程 订阅赛程 返回', [
      '入口页面可通过 Chromium 正常到达',
      '主要内容和核心操作元素可见',
      '执行后页面提供明确结果或下一步',
    ], {
      pageReached: true,
      visibleTargetCount: 3,
      observableFeedback: true,
    });
    expect(result.satisfied).toHaveLength(3);
    expect(result.missing).toEqual([]);
    expect(result.complete).toBe(true);
  });

  it('does not treat ambient countdown changes as feedback from a click', () => {
    expect(hasObservablePageChange(
      'http://localhost/',
      'http://localhost/',
      '比赛将在 33 : 40 : 31 后开始',
      '比赛将在 33 : 40 : 30 后开始',
    )).toBe(false);
    expect(hasObservablePageChange(
      'http://localhost/',
      'http://localhost/',
      '订阅赛程',
      '订阅成功，可以返回',
    )).toBe(true);
    expect(hasObservablePageChange(
      'http://localhost/',
      'http://localhost/',
      '购物车 0',
      '购物车 1',
    )).toBe(true);
    expect(hasObservablePageChange(
      'http://localhost/',
      'http://localhost/details',
      '赛程',
      '赛程',
    )).toBe(true);
  });
});
