import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { observePage } from '../src/test-agent/observer.js';

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required argument: ${name}`);
}

const targetUrl = arg('--url', 'http://127.0.0.1:3000');
const outputDir = resolve(arg('--output', 'real-product-probe'));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: 'zh-CN' });
const page = await context.newPage();

await mkdir(outputDir, { recursive: true });

const snapshots: Array<{
  probeId: string;
  route: string;
  observation: Awaited<ReturnType<typeof observePage>>;
}> = [];

async function capture(probeId: string, route: string, settleMs = 1_200) {
  const url = new URL(route, targetUrl).toString();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(settleMs);
  const screenshotPath = resolve(outputDir, `${probeId}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const observation = await observePage(page, [`${probeId}.png`], `probe-${probeId}`);
  snapshots.push({ probeId, route, observation });
  process.stdout.write(`\n[${probeId}] ${observation.pageUrl}\n`);
  process.stdout.write(`purpose: ${observation.pagePurpose}\n`);
  process.stdout.write(`fields: ${observation.formFields.map((field) => `${field.elementId}:${field.label}:${field.inputType}`).join(' | ') || 'none'}\n`);
  process.stdout.write(`actions: ${observation.interactableElements.slice(0, 30).map((element) => `${element.elementId}:${element.label}`).join(' | ') || 'none'}\n`);
}

try {
  // Keep one browser context so later probes see the real state created by the first task route.
  await capture('01-create-route', '/aquarium?action=create', 1_800);
  await capture('02-record-existing-route', '/aquarium?action=record-existing', 1_200);
  await capture('03-daily-check-route', '/aquarium?action=daily-check', 1_200);

  await writeFile(resolve(outputDir, 'aquaguide-probe.json'), JSON.stringify({
    schemaVersion: 1,
    targetUrl,
    generatedAt: new Date().toISOString(),
    snapshots,
  }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
