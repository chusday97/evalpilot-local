import { createServer } from 'node:http';
import { chromium } from 'playwright';
import type { AgentDecision } from '../types.js';
import { captureTaskStateSignals } from '../src/test-agent/task-state-signals.js';

const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><html><body><main><h1>Ready</h1><div role="status">Loading 25%</div><button disabled>Continue</button></main></body></html>');
});

await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve());
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('fixture server did not expose a port');

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: 'domcontentloaded' });
  const decision: AgentDecision = {
    decisionId: 'serialization-check',
    intentSummary: '验证浏览器侧 Task State capture 可以被 tsx 序列化',
    action: 'click',
    targetElementId: 'E001',
    value: null,
    expectedResult: 'Ready 25%',
    confidence: 1,
  };
  const snapshot = await captureTaskStateSignals(page, decision);
  if (!snapshot.visibleText.includes('Ready')) throw new Error(`Task State missing visible text: ${snapshot.visibleText}`);
  if (!snapshot.statusTexts.some((value) => value.includes('Loading 25%'))) throw new Error(`Task State missing status text: ${JSON.stringify(snapshot.statusTexts)}`);
  if (!snapshot.progressValues.includes('25%')) throw new Error(`Task State missing progress value: ${JSON.stringify(snapshot.progressValues)}`);
  process.stdout.write('Task State browser serialization: PASS\n');
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
