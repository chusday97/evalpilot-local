import { resolve } from 'node:path';
import { chromium } from 'playwright';
import type { PageEvidence } from '../../types.js';
import { EvalPilotError } from '../utils/errors.js';
import { ensureDirectory } from '../utils/file-system.js';
import { collectPageEvidence, isSafeReadOnlyUrl } from './page-evidence.js';
import { recordBrowserErrors } from './network-recorder.js';

export interface ExploreOptions {
  targetUrl: string;
  screenshotsDir: string;
  maxPages?: number;
  navigationTimeoutMs?: number;
}

export async function exploreBrowser(options: ExploreOptions): Promise<PageEvidence[]> {
  await ensureDirectory(options.screenshotsDir);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const recording = recordBrowserErrors(page);
  const maxPages = options.maxPages ?? 5;
  const pending = [options.targetUrl];
  const visited = new Set<string>();
  const evidence: PageEvidence[] = [];

  try {
    while (pending.length > 0 && evidence.length < maxPages) {
      const next = pending.shift();
      if (!next || visited.has(next)) continue;
      visited.add(next);
      await page.goto(next, {
        waitUntil: 'domcontentloaded',
        timeout: options.navigationTimeoutMs ?? 15_000,
      });
      await page.waitForTimeout(250);
      const screenshotPath = resolve(options.screenshotsDir, `page-${String(evidence.length + 1).padStart(2, '0')}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const item = await collectPageEvidence(page, recording, screenshotPath);
      evidence.push(item);
      for (const link of item.links) {
        if (link.href && isSafeReadOnlyUrl(link.href, options.targetUrl) && !visited.has(link.href)) {
          pending.push(link.href);
        }
      }
    }
    return evidence;
  } catch (error) {
    throw new EvalPilotError(`Chromium 页面探索失败：${String(error)}`, 'BROWSER_EXPLORATION_FAILED');
  } finally {
    recording.dispose();
    await context.close();
    await browser.close();
  }
}

