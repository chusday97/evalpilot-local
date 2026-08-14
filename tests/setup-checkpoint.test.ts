import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import type { AutoSetupPlan } from '../src/scenario/setup-resolver.js';
import { captureVerifiedSetupCheckpoint, checkpointAuthScopeKey, resolveSetupCheckpoint, type VerifiedSetupCheckpoint } from '../src/scenario/setup-checkpoint.js';

const browserIt = process.env.EVALPILOT_BROWSER_TEST === '1' ? it : it.skip;
let browser: Browser | null = null;
afterEach(async () => { await browser?.close(); browser = null; });

function plan(taskId: string): AutoSetupPlan {
  return { setupTaskId: taskId } as AutoSetupPlan;
}

function checkpoint(taskId: string, authScopeKey = 'anonymous'): VerifiedSetupCheckpoint {
  return {
    checkpointId: `checkpoint-${taskId}`,
    taskId,
    targetOrigin: 'http://127.0.0.1:41071',
    authScopeKey,
    storageState: { cookies: [], origins: [{ origin: 'http://127.0.0.1:41071', localStorage: [{ name: taskId, value: '1' }] }] },
    sourceRunId: `run-${taskId}`,
    capturedAt: '2026-08-14T00:00:00.000Z',
  };
}

describe('Verified Setup Checkpoint', () => {
  it('uses the deepest verified setup prefix and leaves only later setup steps', () => {
    const plans = [plan('task-create'), plan('task-record')];
    const checkpoints = new Map<string, VerifiedSetupCheckpoint>([
      ['task-create', checkpoint('task-create')],
      ['task-record', checkpoint('task-record')],
    ]);
    const resolved = resolveSetupCheckpoint({ setupPlans: plans, checkpoints, targetUrl: 'http://127.0.0.1:41071/daily', authScopeKey: 'anonymous' });
    expect(resolved.checkpoint?.taskId).toBe('task-record');
    expect(resolved.satisfiedSetupCount).toBe(2);
    expect(resolved.remainingSetupPlans).toEqual([]);
  });

  it('never reuses a checkpoint from another auth scope', () => {
    const plans = [plan('task-create')];
    const checkpoints = new Map<string, VerifiedSetupCheckpoint>([['task-create', checkpoint('task-create', 'auth-other')]]);
    const resolved = resolveSetupCheckpoint({ setupPlans: plans, checkpoints, targetUrl: 'http://127.0.0.1:41071/record', authScopeKey: 'anonymous' });
    expect(resolved.checkpoint).toBeNull();
    expect(resolved.satisfiedSetupCount).toBe(0);
    expect(resolved.remainingSetupPlans).toEqual(plans);
  });

  it('derives auth scope keys without exposing raw storage values', () => {
    expect(checkpointAuthScopeKey(null)).toBe('anonymous');
    const key = checkpointAuthScopeKey({ cookies: [], origins: [{ origin: 'http://127.0.0.1:41071', localStorage: [{ name: 'session', value: 'secret-value' }] }] });
    expect(key).toMatch(/^auth-[a-f0-9]{16}$/);
    expect(key).not.toContain('secret-value');
  });

  browserIt('restores a verified local checkpoint into a new isolated Browser Context', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html><body><main>fixture</main></body></html>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture server did not expose a port');
    const url = `http://127.0.0.1:${address.port}/`;

    try {
      browser = await chromium.launch({ headless: true });
      const sourceContext = await browser.newContext();
      const sourcePage = await sourceContext.newPage();
      await sourcePage.goto(url);
      await sourcePage.evaluate(() => localStorage.setItem('created', '1'));
      const captured = await captureVerifiedSetupCheckpoint({ context: sourceContext, taskId: 'task-create', targetUrl: url, authScopeKey: 'anonymous', sourceRunId: 'run-create' });
      expect(captured).not.toBeNull();
      await sourceContext.close();

      const targetContext = await browser.newContext({ storageState: captured!.storageState });
      const targetPage = await targetContext.newPage();
      await targetPage.goto(url);
      expect(await targetPage.evaluate(() => localStorage.getItem('created'))).toBe('1');
      await targetContext.close();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
