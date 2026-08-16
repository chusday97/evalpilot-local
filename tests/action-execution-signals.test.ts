import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import type { AgentDecision } from '../types.js';
import { executeAgentAction } from '../src/test-agent/action-executor.js';
import { collectObservedPreFailureSignals } from '../src/test-agent/action-execution-signals.js';
import { observePage } from '../src/test-agent/observer.js';

const browserDescribe = process.env.EVALPILOT_BROWSER_TEST === '1' ? describe : describe.skip;

function clickDecision(targetElementId: string): AgentDecision {
  return {
    intentSummary: '选择标准款物种变体',
    action: 'click',
    targetElementId,
    value: null,
    expectedResult: '标准款被选择',
    confidence: 1,
  };
}

describe('pre-failure action execution signals', () => {
  it('classifies Playwright pointer interception without changing the terminal failure source', () => {
    const signals = collectObservedPreFailureSignals([{
      status: 'failed',
      action: 'click',
      targetElementId: 'element-variant-standard',
      summary: '<button aria-label="wishlist">♥</button> intercepts pointer events',
      evidenceRefs: ['step-004-before.png'],
    }]);

    expect(signals).toEqual([{
      type: 'action_execution_failure',
      action: 'click',
      targetElementId: 'element-variant-standard',
      cause: 'pointer_interception',
      summary: '<button aria-label="wishlist">♥</button> intercepts pointer events',
      evidenceRefs: ['step-004-before.png'],
    }]);
  });

  it('ignores successfully executed actions', () => {
    expect(collectObservedPreFailureSignals([{
      status: 'executed',
      action: 'click',
      targetElementId: 'element-save',
      summary: 'click 已执行。',
      evidenceRefs: [],
    }])).toEqual([]);
  });
});

browserDescribe('variant card pointer interception regression', () => {
  it('preserves the failed grounded click as deterministic pre-failure evidence', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`
        <!doctype html>
        <html>
          <body>
            <div
              role="button"
              tabindex="0"
              aria-label="标准款"
              style="position: relative; width: 240px; height: 100px; border: 1px solid black;"
            >
              标准款
              <button
                type="button"
                aria-label="wishlist"
                style="position: absolute; inset: 0; z-index: 2; background: transparent; border: 0;"
              >♥</button>
            </div>
          </body>
        </html>
      `);

      const observation = await observePage(page);
      const variant = observation.interactableElements.find((item) => item.text.includes('标准款'));
      expect(variant).toBeTruthy();

      const result = await executeAgentAction(page, observation, clickDecision(variant!.elementId));
      expect(result.status).toBe('failed');
      expect(result.summary).toMatch(/intercepts pointer events/i);

      const signals = collectObservedPreFailureSignals([result]);
      expect(signals).toHaveLength(1);
      expect(signals[0]).toMatchObject({
        type: 'action_execution_failure',
        action: 'click',
        targetElementId: variant!.elementId,
        cause: 'pointer_interception',
      });
    } finally {
      await browser.close();
    }
  });
});
