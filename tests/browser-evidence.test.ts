import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { collectPageEvidence, isSafeReadOnlyUrl } from '../src/browser/page-evidence.js';

const browserDescribe = process.env.EVALPILOT_BROWSER_TEST === '1' ? describe : describe.skip;

browserDescribe('browser evidence extraction', () => {
  it('collects visible UI and marks high-risk actions without clicking them', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html lang="zh-CN"><head><title>测试产品</title></head><body>
      <h1>产品首页</h1><a href="/safe">查看详情</a><button>开始搜索</button><button>删除账户</button>
      <form><label>关键词<input name="query" /></label></form><img src="missing.png">
    </body></html>`);
    const directory = await mkdtemp(join(tmpdir(), 'evalpilot-browser-'));
    const screenshot = resolve(directory, 'page.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    const evidence = await collectPageEvidence(
      page,
      { consoleErrors: [], networkErrors: [], dispose: () => undefined },
      screenshot,
    );
    await browser.close();

    expect(evidence.title).toBe('测试产品');
    expect(evidence.buttons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: '开始搜索', risk: 'safe' }),
        expect.objectContaining({ text: '删除账户', risk: 'high' }),
      ]),
    );
    expect(evidence.inputs[0]).toMatchObject({ name: 'query', type: 'input' });
    expect(evidence.accessibility).toMatchObject({ lang: 'zh-CN', imageAltMissing: 1 });
  });
});

describe('safe browser navigation', () => {
  it('allows only safe same-origin HTTP(S) links', () => {
    const target = 'http://localhost:3000';
    expect(isSafeReadOnlyUrl('/details', target)).toBe(true);
    expect(isSafeReadOnlyUrl('/delete-account', target)).toBe(false);
    expect(isSafeReadOnlyUrl('https://example.com', target)).toBe(false);
    expect(isSafeReadOnlyUrl('javascript:alert(1)', target)).toBe(false);
  });
});
