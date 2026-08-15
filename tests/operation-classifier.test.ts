import { describe, expect, it } from 'vitest';
import { classifyOperation } from '../src/test-agent/operation-classifier.js';

function observation(label: string, options: { tagName?: string; role?: string | null; visible?: string } = {}) {
  return {
    interactableElements: [{
      elementId: 'E001',
      role: options.role ?? 'button',
      tagName: options.tagName ?? 'button',
      label,
      text: label,
      placeholder: null,
      disabled: false,
      risk: 'safe',
      locatorHint: 'grounded-index:0',
    }],
    formFields: [],
    visibleStateSummary: options.visible ?? 'AquaGuide Aquarium care assistant My Aquarium Settings',
    primaryAreas: ['My Aquarium'],
  } as any;
}

function decision(label: string, expectedResult: string) {
  return {
    decisionId: 'decision-001',
    intentSummary: label,
    action: 'click',
    targetElementId: 'E001',
    value: null,
    expectedResult,
    confidence: 1,
  } as any;
}

const evalCase = {
  title: '创建一个可用鱼缸',
  goal: '创建一个可用鱼缸',
  hypothesis: '用户可以完成任务',
  capabilityId: 'cap-aquarium',
  taskId: 'task-create',
  generationReason: 'baseline',
  oracle: { expectedOutcome: ['完成任务'], mustObserve: ['完成任务'] },
} as any;

describe('operation classifier action locality', () => {
  it('keeps an ordinary settings click synchronous even when global page copy says assistant', () => {
    expect(classifyOperation({
      decision: decision('打开鱼缸设置', '显示尺寸和水体设置'),
      observation: observation('Tank Settings'),
      evalCase,
    })).toBe('synchronous');
  });

  it('does not treat a Create entry-point button as a persisted form submit', () => {
    expect(classifyOperation({
      decision: decision('打开鱼缸配置流程', '显示尺寸和水体设置'),
      observation: observation('Create or configure a tank'),
      evalCase,
    })).toBe('synchronous');
  });

  it('keeps an ordinary answer button synchronous instead of applying unknown_async timeout', () => {
    expect(classifyOperation({
      decision: decision('回答每日检查第 1 项：经常浮头', '每日检查进度变为 1 / 6'),
      observation: observation('经常浮头'),
      evalCase,
    })).toBe('synchronous');
  });

  it('classifies an explicitly AI-generating action from local action semantics', () => {
    expect(classifyOperation({
      decision: decision('Generate AI summary', 'AI summary appears'),
      observation: observation('Generate'),
      evalCase,
    })).toBe('ai_generation');
  });

  it('keeps save/create submissions on the form-submit wait policy when the Agent intent commits state', () => {
    expect(classifyOperation({
      decision: decision('保存鱼缸设置', '已保存设置'),
      observation: observation('Save Settings'),
      evalCase,
    })).toBe('form_submit');
  });

  it('keeps links on the navigation wait policy', () => {
    expect(classifyOperation({
      decision: decision('打开帮助', '进入帮助页面'),
      observation: observation('Help', { tagName: 'a', role: 'link' }),
      evalCase,
    })).toBe('navigation');
  });
});
