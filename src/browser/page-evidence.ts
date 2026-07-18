import type { ElementEvidence, PageEvidence } from '../../types.js';
import type { Page } from 'playwright';
import type { NetworkRecording } from './network-recorder.js';

const highRiskPattern = /(删除|支付|付款|购买|发送|发布|提交订单|delete|pay|purchase|send|publish)/i;

function riskFor(text: string): ElementEvidence['risk'] {
  return highRiskPattern.test(text) ? 'high' : 'safe';
}

export async function collectPageEvidence(
  page: Page,
  recording: NetworkRecording,
  screenshot: string | null,
): Promise<PageEvidence> {
  const snapshot = await page.evaluate(() => {
    const visibleText = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 20_000);
    const links = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].map((element) => ({
      text: (element.innerText || element.getAttribute('aria-label') || '').trim(),
      href: element.href,
    }));
    const buttons = [...document.querySelectorAll<HTMLElement>('button, [role="button"]')].map((element) => ({
      text: (element.innerText || element.getAttribute('aria-label') || '').trim(),
      role: element.getAttribute('role') || element.tagName.toLowerCase(),
      disabled: element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true',
    }));
    const inputs = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')].map((element) => ({
      text: element.getAttribute('aria-label') || element.getAttribute('placeholder') || '',
      type: element.getAttribute('type') || element.tagName.toLowerCase(),
      name: element.getAttribute('name') || undefined,
      disabled: element.disabled,
    }));
    return {
      visibleText,
      links,
      buttons,
      inputs,
      forms: document.querySelectorAll('form').length,
      dialogs: document.querySelectorAll('dialog, [role="dialog"]').length,
      lang: document.documentElement.lang || null,
      headings: [...document.querySelectorAll('h1, h2, h3')].map((element) => (element.textContent ?? '').trim()).filter(Boolean).slice(0, 100),
      imageAltMissing: [...document.images].filter((image) => !image.hasAttribute('alt') || image.alt.trim() === '').length,
    };
  });

  return {
    url: page.url(),
    title: await page.title(),
    visibleText: snapshot.visibleText,
    links: snapshot.links.map((element) => ({ ...element, risk: riskFor(element.text) })),
    buttons: snapshot.buttons.map((element) => ({ ...element, risk: riskFor(element.text) })),
    inputs: snapshot.inputs.map((element) => ({ ...element, risk: riskFor(element.text) })),
    forms: snapshot.forms,
    dialogs: snapshot.dialogs,
    accessibility: {
      lang: snapshot.lang,
      headings: snapshot.headings,
      imageAltMissing: snapshot.imageAltMissing,
    },
    screenshot,
    consoleErrors: [...recording.consoleErrors],
    networkErrors: [...recording.networkErrors],
    exploredAt: new Date().toISOString(),
  };
}

export function isSafeReadOnlyUrl(candidate: string, targetUrl: string): boolean {
  try {
    const url = new URL(candidate, targetUrl);
    const target = new URL(targetUrl);
    return (
      url.origin === target.origin &&
      ['http:', 'https:'].includes(url.protocol) &&
      !highRiskPattern.test(`${url.pathname}${url.search}`) &&
      !url.hash.startsWith('#delete')
    );
  } catch {
    return false;
  }
}

