import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { stabilizeFunctionalEntry } from '../src/test-agent/functional-entry-stabilization.js';

const browserEnabled = process.env.EVALPILOT_BROWSER_TEST === '1';
let server: Server | null = null;

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
});

async function transientApp(): Promise<string> {
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><body>
      <main id="app"><h1>Start with what is true today</h1><button>Create my first aquarium</button></main>
      <script>
        setTimeout(() => {
          document.querySelector('#app').innerHTML = '<h1>Daily Aquarium Check</h1><p>0 / 6</p><button>经常浮头</button>';
        }, 250);
      </script>
    </body></html>`);
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture server did not bind');
  return `http://127.0.0.1:${address.port}/aquarium?action=daily-check`;
}

(browserEnabled ? describe : describe.skip)('Functional entry stabilization in Chromium', () => {
  it('waits through a transient hydrated fallback before handing the page to the Functional Actor', async () => {
    const startingUrl = await transientApp();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const result = await stabilizeFunctionalEntry(page, startingUrl, {
        networkIdleTimeoutMs: 1_500,
        hardTimeoutMs: 2_500,
        pollIntervalMs: 50,
        quietPollsRequired: 3,
      });

      expect(await page.getByText('Daily Aquarium Check', { exact: true }).isVisible()).toBe(true);
      expect(await page.getByText('Create my first aquarium', { exact: true }).isVisible()).toBe(false);
      expect(result).toEqual(expect.objectContaining({
        mode: 'functional_entry_stabilization',
        requestedUrl: startingUrl,
        finalUrl: startingUrl,
        networkIdleObserved: true,
        domChangedDuringStabilization: true,
        reason: 'network_idle_and_dom_quiet',
      }));
      expect(result.elapsedMs).toBeGreaterThanOrEqual(250);
    } finally {
      await context.close();
      await browser.close();
    }
  });
});
