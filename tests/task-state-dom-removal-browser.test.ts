import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import type { AgentActionResult, AgentDecision } from '../types.js';
import { captureTaskStateSignals, compareTaskStateSignals } from '../src/test-agent/task-state-signals.js';
import { observeTaskState } from '../src/test-agent/task-state-monitor.js';

const decision: AgentDecision = { decisionId: 'save-modal', intentSummary: 'Save settings and close dialog', action: 'click', targetElementId: 'E001', value: null, expectedResult: 'Settings saved', confidence: 1 };
const actionResult: AgentActionResult = { status: 'executed', action: 'click', targetElementId: 'E001', summary: 'Clicked Save', evidenceRefs: ['before.png', 'after.png'] };

describe.skipIf(process.env.EVALPILOT_BROWSER_TEST !== '1')('TaskState DOM contraction in Chromium', () => {
  it('captures a real modal close as structural progress without fabricating completion', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`<!doctype html><html><body><main>
        <h1>Aquarium overview</h1><p>Tank is active.</p>
        <section role="dialog" aria-modal="true"><h2>Settings</h2><p>Adjust tank settings.</p><button id="save" onclick="this.closest('[role=dialog]').remove()">Save</button><button>Cancel</button></section>
      </main></body></html>`);

      const before = await captureTaskStateSignals(page, decision);
      await page.locator('#save').click();
      const after = await captureTaskStateSignals(page, decision);
      const delta = compareTaskStateSignals(before, after);

      expect(after.nodeCount).toBeLessThan(before.nodeCount);
      expect(after.visibleText).not.toBe(before.visibleText);
      expect(delta.progressSignals).toContain('页面结构收敛且可见内容发生变化');
      expect(delta.completionSignals).toEqual([]);

      const observed = observeTaskState({
        before,
        after,
        decision,
        actionResult,
        waitResult: { signal: 'network_idle', summary: 'network idle' },
        elapsedMs: 120,
        networkActivity: 'idle',
        networkResponses: 0,
        coreNetworkFailures: [],
        consoleErrors: [],
        evidenceRefs: ['before.png', 'after.png'],
      });
      expect(observed).toMatchObject({ state: 'progressing', completionSignals: [], failureSignals: [] });
    } finally {
      await browser.close();
    }
  }, 60_000);
});