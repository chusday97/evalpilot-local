import type { Page } from 'playwright';
import type { AgentDecision } from '../../types.js';

export interface PageWaitBaseline {
  url: string;
  visibleText: string;
  scrollY: number;
}

export interface AdaptiveWaitResult {
  signal: 'target_text' | 'route_change' | 'field_value' | 'loading_complete' | 'network_idle' | 'dom_change' | 'scroll_change' | 'timeout' | 'not_needed';
  summary: string;
}

const loadingSelector = '[aria-busy="true"],[role="progressbar"],.loading,.spinner,[data-loading="true"]';

function expectedTokens(value: string): string[] {
  const latin = value.toLocaleLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [];
  const han = value.match(/[\p{Script=Han}]{2,}/gu) ?? [];
  return [...new Set([...latin, ...han])].slice(0, 12);
}

export async function capturePageWaitBaseline(page: Page): Promise<PageWaitBaseline> {
  return {
    url: page.url(),
    visibleText: (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim(),
    scrollY: await page.evaluate(() => window.scrollY).catch(() => 0),
  };
}

export async function waitForAdaptiveOutcome(page: Page, baseline: PageWaitBaseline, decision: AgentDecision, timeoutMs: number): Promise<AdaptiveWaitResult> {
  if (decision.action === 'finish' || decision.action === 'abandon') return { signal: 'not_needed', summary: '结束动作不需要等待页面变化。' };
  const boundedTimeout = Math.min(5_000, Math.max(250, timeoutMs));
  if ((decision.action === 'fill' || decision.action === 'select') && decision.targetElementId) {
    const targetIndex = Number(decision.targetElementId.slice(1)) - 1;
    try {
      await page.locator('a,button,input,select,textarea,[role="button"],[role="link"],[tabindex]').nth(targetIndex).waitFor({ state: 'visible', timeout: boundedTimeout });
      const value = await page.locator('a,button,input,select,textarea,[role="button"],[role="link"],[tabindex]').nth(targetIndex).inputValue();
      if (value === (decision.value ?? '')) return { signal: 'field_value', summary: '目标字段已显示本次输入值。' };
    } catch { /* fall through to bounded page signals */ }
  }
  if (decision.action === 'scroll') {
    try {
      await page.waitForFunction((scrollY) => window.scrollY !== scrollY, baseline.scrollY, { timeout: boundedTimeout });
      return { signal: 'scroll_change', summary: '页面滚动位置已变化。' };
    } catch { return { signal: 'timeout', summary: '在等待上限内没有观察到滚动变化。' }; }
  }
  const tokens = expectedTokens(decision.expectedResult);
  const hasLoading = await page.locator(loadingSelector).filter({ visible: true }).count().catch(() => 0) > 0;
  if (hasLoading) {
    try {
      await page.waitForFunction(({ selector, expected }) => {
        const text = document.body?.innerText.toLocaleLowerCase() ?? '';
        const targetSeen = expected.some((token) => text.includes(token));
        const loading = Array.from(document.querySelectorAll(selector)).some((node) => {
          const element = node as HTMLElement; const style = getComputedStyle(element);
          return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
        });
        return targetSeen || !loading;
      }, { selector: loadingSelector, expected: tokens }, { timeout: boundedTimeout });
      const text = (await page.locator('body').innerText().catch(() => '')).toLocaleLowerCase();
      return tokens.some((token) => text.includes(token))
        ? { signal: 'target_text', summary: '等待期间出现了预期文字。' }
        : { signal: 'loading_complete', summary: '页面加载标记已消失。' };
    } catch { return { signal: 'timeout', summary: '页面加载在等待上限内没有完成。' }; }
  }
  try {
    await page.waitForFunction(({ initialUrl, expected }) => {
      const text = document.body?.innerText.toLocaleLowerCase() ?? '';
      return location.href !== initialUrl || expected.some((token) => text.includes(token));
    }, { initialUrl: baseline.url, expected: tokens }, { timeout: boundedTimeout });
    if (page.url() !== baseline.url) return { signal: 'route_change', summary: `页面已进入 ${page.url()}。` };
    return { signal: 'target_text', summary: '等待期间出现了预期文字。' };
  } catch {
    const networkIdle = await page.waitForLoadState('networkidle', { timeout: Math.min(500, boundedTimeout) }).then(() => true).catch(() => false);
    const currentText = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    return currentText !== baseline.visibleText
      ? { signal: 'dom_change', summary: '页面内容发生变化，但未直接匹配预期文字。' }
      : networkIdle
        ? { signal: 'network_idle', summary: '网络已空闲，但页面没有出现预期反馈。' }
        : { signal: 'timeout', summary: '在等待上限内没有观察到页面反馈。' };
  }
}
