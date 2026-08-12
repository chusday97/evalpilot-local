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
  process.stdout.write(`actions: ${observation.interactableElements.slice(0, 120).map((element) => `${element.elementId}:${element.label}`).join(' | ') || 'none'}\n`);
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

  const settingsEntry = page.getByRole('button', { name: /建立或完善鱼缸|打开设置/ }).first();
  await settingsEntry.waitFor({ state: 'visible' });
  await settingsEntry.click();
  await page.waitForTimeout(900);
  await saveObservation('03-tank-settings-open', '/aquarium -> 建立或完善鱼缸');

  const sizeInputs = page.locator('input[type="number"]');
  if (await sizeInputs.count() < 3) throw new Error('AquaGuide settings did not expose three dimension inputs.');
  await sizeInputs.nth(0).fill('60');
  await sizeInputs.nth(1).fill('30');
  await sizeInputs.nth(2).fill('30');

  const parameterPanel = page.getByRole('button', { name: /参数.*水体未记录|水体未记录.*目标温度未记录/ }).first();
  await parameterPanel.waitFor({ state: 'visible' });
  await parameterPanel.click();
  await page.waitForTimeout(600);
  await saveObservation('04-water-parameters-open', '/aquarium -> settings -> parameters');

  await page.getByRole('button', { name: /淡水.*常见观赏鱼/ }).first().click();
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.waitForTimeout(1_000);
  await saveObservation('05-usable-tank-saved', 'save 60x30x30 freshwater settings');

  await page.goto(new URL('/aquarium?action=record-existing', targetUrl).toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await saveObservation('06-record-existing-route', '/aquarium?action=record-existing');
  const fishSearch = page.getByPlaceholder(/搜索鱼、虾、螺/).first();
  await fishSearch.fill('咖啡鼠');
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: /咖啡鼠/ }).first().click();
  await page.waitForTimeout(500);
  await saveObservation('07-record-existing-selected', 'selected 咖啡鼠');

  const saveToTank = page.getByRole('button', { name: '保存到鱼缸', exact: true });
  await saveToTank.waitFor({ state: 'visible' });
  await saveToTank.click();
  await page.waitForTimeout(1_000);
  await saveObservation('08-record-existing-confirmed', 'record 咖啡鼠');

  await page.goto(new URL('/aquarium?action=daily-check', targetUrl).toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await saveObservation('09-daily-check-ready', '/aquarium?action=daily-check after livestock');
  for (const label of ['经常浮头', '清澈', '没有泡沫或油膜', '没有异味', '正常游动和进食', '没有特别操作']) {
    await page.getByRole('button', { name: label, exact: true }).click();
  }
  const generate = page.getByRole('button', { name: /生成检查结果/ }).first();
  await generate.waitFor({ state: 'visible' });
  await generate.click();
  await page.waitForTimeout(1_500);
  await saveObservation('10-daily-check-high-risk-result', 'frequent surface breathing daily check');

  await writeFile(resolve(outputDir, 'aquaguide-probe.json'), JSON.stringify({
    schemaVersion: 7,
    targetUrl,
    generatedAt: new Date().toISOString(),
    snapshots,
  }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
