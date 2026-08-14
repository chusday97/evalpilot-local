import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import type { AgentDecision } from '../types.js';
import { executeAgentAction } from '../src/test-agent/action-executor.js';
import { observePage } from '../src/test-agent/observer.js';

const browserDescribe = process.env.EVALPILOT_BROWSER_TEST === '1' ? describe : describe.skip;

function fillDecision(targetElementId: string, value: string): AgentDecision {
  return {
    intentSummary: '填写已观察到的字段',
    action: 'fill',
    targetElementId,
    value,
    expectedResult: '字段显示输入值',
    confidence: 1,
  };
}

browserDescribe('grounded action identity', () => {
  it('replays the Observer DOM index without re-filtering hidden or modal-excluded elements', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`
        <!doctype html>
        <html>
          <body>
            <button id="hidden" style="display:none">Hidden</button>
            <button id="outside">Outside modal</button>
            <div role="dialog" aria-modal="true">
              <input id="length" type="number" aria-label="Length">
              <button id="save">Save Settings</button>
            </div>
          </body>
        </html>
      `);

      const observation = await observePage(page);
      const field = observation.formFields.find((item) => item.label === 'Length');
      expect(field).toBeTruthy();
      expect(field?.locatorHint).toBe('grounded-index:2');

      const result = await executeAgentAction(page, observation, fillDecision(field!.elementId, '60'));

      expect(result.status).toBe('executed');
      await expect(page.locator('#length').inputValue()).resolves.toBe('60');
      await expect(page.locator('#save').textContent()).resolves.toBe('Save Settings');
    } finally {
      await browser.close();
    }
  });

  it('fails closed when the DOM index now resolves to a different element type', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`
        <!doctype html>
        <html>
          <body>
            <div role="dialog" aria-modal="true">
              <input id="length" type="number" aria-label="Length">
              <button id="save">Save Settings</button>
            </div>
          </body>
        </html>
      `);

      const observation = await observePage(page);
      const field = observation.formFields.find((item) => item.label === 'Length');
      expect(field).toBeTruthy();
      expect(field?.locatorHint).toBe('grounded-index:0');

      await page.locator('[role="dialog"]').evaluate((dialog) => {
        const button = document.createElement('button');
        button.id = 'inserted';
        button.textContent = 'Inserted before observed input';
        dialog.prepend(button);
      });

      const result = await executeAgentAction(page, observation, fillDecision(field!.elementId, '60'));

      expect(result.status).toBe('failed');
      expect(result.summary).toContain('DOM grounding 已漂移');
      await expect(page.locator('#length').inputValue()).resolves.toBe('');
    } finally {
      await browser.close();
    }
  });
});
