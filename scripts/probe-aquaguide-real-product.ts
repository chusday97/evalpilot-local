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

async function saveObservation(probeId: string, requestedRoute: string) {
  const screenshotPath = resolve(outputDir, `${probeId}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const observation = await observePage(page, [`${probeId}.png`], `probe-${probeId}`);
  snapshots.push({ probeId, route: requestedRoute, observation });
  process.stdout.write(`\n[${probeId}] requested=${requestedRoute} actual=${observation.pageUrl}\n`);
  process.stdout.write(`purpose: ${observation.pagePurpose}\n`);
  process.stdout.write(`fields: ${observation.formFields.map((field) => `${field.elementId}:${field.label}:${field.inputType}:required=${field.required}`).join(' | ') || 'none'}\n`);
  process.stdout.write(`actions: ${observation.interactableElements.slice(0, 80).map((element) => `${element.elementId}:${element.label}`).join(' | ') || 'none'}\n`);
}

async function navigateAndCapture(probeId: string, route: string, settleMs = 1_200) {
  const url = new URL(route, targetUrl).toString();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(settleMs);
  await saveObservation(probeId, route);
}

try {
  await navigateAndCapture('01-create-deeplink-pristine', '/aquarium?action=create', 1_800);

  if (new URL(page.url()).pathname === '/welcome') {
    const buildTank = page.getByRole('button', { name: /建立第一个鱼缸/ }).first();
    await buildTank.waitFor({ state: 'visible' });
    await buildTank.click();
    await page.waitForTimeout(1_800);
  }
  await saveObservation('02-create-after-onboarding', '/welcome -> 建立第一个鱼缸');

  // Capture the real settings surface needed to turn the empty draft into a usable tank.
  const settingsEntry = page.getByRole('button', { name: /建立或完善鱼缸|打开设置/ }).first();
  await settingsEntry.waitFor({ state: 'visible' });
  await settingsEntry.click();
  await page.waitForTimeout(900);
  await saveObservation('03-tank-settings-open', '/aquarium -> 建立或完善鱼缸');

  // Navigation resets the settings modal while preserving the aquarium created in the same browser context.
  await navigateAndCapture('04-record-existing-route', '/aquarium?action=record-existing', 1_200);
  await navigateAndCapture('05-daily-check-route', '/aquarium?action=daily-check', 1_200);

  await writeFile(resolve(outputDir, 'aquaguide-probe.json'), JSON.stringify({
    schemaVersion: 3,
    targetUrl,
    generatedAt: new Date().toISOString(),
    snapshots,
  }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
