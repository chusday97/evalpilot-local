import { describe, expect, it } from 'vitest';
import type { AgentActionResult, AgentDecision, StepVerification } from '../types.js';
import type { AdaptiveWaitResult } from '../src/test-agent/adaptive-wait.js';
import type { TaskStateSignalSnapshot } from '../src/test-agent/task-state-signals.js';
import { gateVerificationByTaskState, observeTaskState } from '../src/test-agent/task-state-monitor.js';

const decision: AgentDecision = { decisionId: 'decision-001', intentSummary: '生成报告', action: 'click', targetElementId: 'E001', value: null, expectedResult: '报告已生成', confidence: 1 };
const actionResult: AgentActionResult = { status: 'executed', action: 'click', targetElementId: 'E001', summary: '已点击', evidenceRefs: ['before.png', 'after.png'] };
const waitResult = (signal: AdaptiveWaitResult['signal']): AdaptiveWaitResult => ({ signal, summary: signal });
const snapshot = (changes: Partial<TaskStateSignalSnapshot> = {}): TaskStateSignalSnapshot => ({
  visibleText: '生成报告', visibleTextLength: 4, nodeCount: 3, loadingSignals: [], statusTexts: [], progressValues: [], expectedMatches: [], completionMarkers: [], failureSignals: [], targetDisabled: false, ...changes,
});

function observe(changes: Partial<Parameters<typeof observeTaskState>[0]> = {}) {
  return observeTaskState({
    before: snapshot(), after: snapshot(), decision, actionResult, waitResult: waitResult('network_idle'), elapsedMs: 800,
    networkActivity: 'idle', networkResponses: 0, coreNetworkFailures: [], consoleErrors: [], evidenceRefs: ['before.png', 'after.png'], ...changes,
  });
}

describe('Task State Monitor', () => {
  it('keeps a visible loading state pending instead of failing it', () => {
    expect(observe({ after: snapshot({ loadingSignals: ['页面存在 aria-busy=true'] }), waitResult: waitResult('timeout') })).toMatchObject({ state: 'pending', failureSignals: [], lastProgressAtMs: null });
  });

  it('recognizes status, DOM and network changes as progress', () => {
    expect(observe({
      after: snapshot({ visibleText: '生成报告 25%', visibleTextLength: 10, nodeCount: 4, loadingSignals: ['页面显示进度条'], statusTexts: ['正在生成'], progressValues: ['25%'] }),
      networkActivity: 'active', networkResponses: 2,
    })).toMatchObject({ state: 'progressing', progressSignals: expect.arrayContaining(['页面可见内容增加', '进度数值发生变化', '操作后仍有网络响应返回']), lastProgressAtMs: 800 });
  });

  it('recognizes a newly visible expected result as completed', () => {
    expect(observe({ after: snapshot({ visibleText: '报告已生成', visibleTextLength: 5, expectedMatches: ['报告已生成'] }) })).toMatchObject({ state: 'completed', completionSignals: ['出现预期结果线索：报告已生成'] });
  });

  it('recognizes core request and uncaught errors as failed', () => {
    expect(observe({ coreNetworkFailures: ['500 http://localhost/api/report'], consoleErrors: ['render crashed'] })).toMatchObject({ state: 'failed', failureSignals: expect.arrayContaining(['核心请求失败：500 http://localhost/api/report', '页面未捕获错误：render crashed']) });
  });

  it('distinguishes a silent timeout from an active pending task', () => {
    expect(observe({ waitResult: waitResult('timeout') })).toMatchObject({ state: 'stalled', progressSignals: [], loadingSignals: [] });
  });

  it('records safety blocking separately from product failure', () => {
    expect(observe({ actionResult: { ...actionResult, status: 'blocked_by_safety', summary: '需要真实凭证' } })).toMatchObject({ state: 'blocked', confidence: 1 });
  });

  it('keeps action screenshots attached even when task state does not gate the verdict', () => {
    const verification: StepVerification = { verificationId: 'verification-001', expectation: '输入已填写', observed: '输入框已有值', status: 'confirmed', evidenceRefs: [], confidence: 0.9 };
    const taskState = { ...observe(), state: 'interacting' as const, evidenceRefs: ['before.png', 'after.png'] };
    expect(gateVerificationByTaskState(verification, taskState)).toMatchObject({ status: 'confirmed', evidenceRefs: ['before.png', 'after.png'] });
  });

  it.each(['pending', 'progressing'] as const)('gates %s verification to inconclusive', (state) => {
    const verification: StepVerification = { verificationId: 'verification-001', expectation: '报告已生成', observed: '暂未出现', status: 'not_confirmed', evidenceRefs: ['after.png'], confidence: 0.9 };
    const taskState = { ...observe(), state };
    expect(gateVerificationByTaskState(verification, taskState)).toMatchObject({ status: 'inconclusive', observed: expect.stringContaining('当前证据不足以判定成功或失败'), evidenceRefs: expect.arrayContaining(['before.png', 'after.png']) });
  });
});
