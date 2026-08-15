import { describe, expect, it } from 'vitest';
import type { AgentActionResult, AgentDecision } from '../types.js';
import type { AdaptiveWaitResult } from '../src/test-agent/adaptive-wait.js';
import { observeTaskState } from '../src/test-agent/task-state-monitor.js';
import { compareTaskStateSignals, type TaskStateSignalSnapshot } from '../src/test-agent/task-state-signals.js';

const decision: AgentDecision = { decisionId: 'save-settings', intentSummary: 'Save settings', action: 'click', targetElementId: 'E001', value: null, expectedResult: 'Settings saved', confidence: 1 };
const actionResult: AgentActionResult = { status: 'executed', action: 'click', targetElementId: 'E001', summary: 'Clicked Save', evidenceRefs: ['before.png', 'after.png'] };
const waitResult: AdaptiveWaitResult = { signal: 'network_idle', summary: 'network idle' };

function snapshot(changes: Partial<TaskStateSignalSnapshot> = {}): TaskStateSignalSnapshot {
  return {
    visibleText: 'Settings Save Cancel', visibleTextLength: 20, nodeCount: 12,
    loadingSignals: [], statusTexts: [], progressValues: [], expectedMatches: [], completionMarkers: [], failureSignals: [], targetDisabled: false,
    ...changes,
  };
}

describe('TaskState DOM contraction', () => {
  it('recognizes modal/temporary DOM removal with visible state change as progress', () => {
    const delta = compareTaskStateSignals(
      snapshot(),
      snapshot({ visibleText: 'Aquarium overview', visibleTextLength: 17, nodeCount: 5 }),
    );
    expect(delta.progressSignals).toContain('页面结构收敛且可见内容发生变化');
  });

  it('does not let structural progress override a simultaneous failure signal', () => {
    const observed = observeTaskState({
      before: snapshot(),
      after: snapshot({ visibleText: 'Aquarium overview Save failed', visibleTextLength: 29, nodeCount: 6, failureSignals: ['Save failed'] }),
      decision,
      actionResult,
      waitResult,
      elapsedMs: 500,
      networkActivity: 'idle',
      networkResponses: 0,
      coreNetworkFailures: [],
      consoleErrors: [],
      evidenceRefs: ['before.png', 'after.png'],
    });

    expect(observed.progressSignals).toContain('页面结构收敛且可见内容发生变化');
    expect(observed).toMatchObject({ state: 'failed', failureSignals: ['Save failed'] });
  });
});