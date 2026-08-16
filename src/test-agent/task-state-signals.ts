import type { Page } from 'playwright';
import type { AgentDecision } from '../../types.js';

export interface TaskStateSignalSnapshot {
  visibleText: string;
  visibleTextLength: number;
  nodeCount: number;
  loadingSignals: string[];
  statusTexts: string[];
  progressValues: string[];
  expectedMatches: string[];
  completionMarkers: string[];
  failureSignals: string[];
  targetDisabled: boolean | null;
}

export interface TaskStateSignalDelta {
  progressSignals: string[];
  completionSignals: string[];
  failureSignals: string[];
  loadingSignals: string[];
}

const expectedTokens = (value: string): string[] => {
  const latin = value.toLocaleLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [];
  const han = value.match(/[\p{Script=Han}]{2,}/gu) ?? [];
  return [...new Set([...latin, ...han])].slice(0, 12);
};

export async function captureTaskStateSignals(page: Page, decision: AgentDecision): Promise<TaskStateSignalSnapshot> {
  const tokens = expectedTokens(decision.expectedResult);
  const targetIndex = decision.targetElementId ? Number(decision.targetElementId.slice(1)) - 1 : -1;
  return page.evaluate(({ expected, groundedIndex }) => {
    // IMPORTANT: do not declare helper functions inside this callback. EvalPilot often runs from source
    // through tsx/esbuild; keep-name transforms can inject `__name(...)` into browser-serialized helpers,
    // but Playwright does not serialize esbuild's runtime helper. Keep every browser-side operation inline.
    const bodyText = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim();
    const lowerBodyText = bodyText.toLocaleLowerCase();
    const loading: string[] = [];

    if (Array.from(document.querySelectorAll('[aria-busy="true"]')).some((element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
    })) loading.push('页面存在 aria-busy=true');
    if (Array.from(document.querySelectorAll('[role="progressbar"]')).some((element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
    })) loading.push('页面显示进度条');
    if (Array.from(document.querySelectorAll('.loading,.spinner,[data-loading="true"]')).some((element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
    })) loading.push('页面显示加载动画');

    const loadingWords = ['loading', 'generating', 'processing', 'uploading', 'thinking', 'searching', '加载中', '生成中', '处理中', '上传中', '思考中', '搜索中'];
    for (const word of loadingWords) if (lowerBodyText.includes(word)) loading.push(`页面显示“${word}”`);

    const statusElements = Array.from(document.querySelectorAll('[role="status"],[aria-live],[data-status],[role="progressbar"],[aria-busy="true"],.loading,.spinner,[data-loading="true"]')).filter((element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
    });
    const statusTexts = [...new Set(statusElements
      .map((element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter(Boolean))].slice(0, 12);
    const progressValues = [...new Set(statusElements.flatMap((element) => {
      const values = [element.getAttribute('aria-valuenow'), element.getAttribute('data-progress')].filter((value): value is string => Boolean(value));
      const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
      return [...values, ...(text.match(/\b\d{1,3}%/g) ?? []), ...(text.match(/\b\d+\s*\/\s*\d+\b/g) ?? [])];
    }).filter(Boolean))].slice(0, 12);

    const completionMarkers = Array.from(document.querySelectorAll('[data-status="complete"],[data-status="completed"],[data-status="success"]'))
      .filter((element) => {
        if (!(element instanceof HTMLElement)) return false;
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
      })
      .map((element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim() || `data-status=${element.getAttribute('data-status')}`)
      .slice(0, 12);
    const failureSignals = [...new Set(Array.from(document.querySelectorAll('[role="alert"],[data-status="failed"],[data-status="error"],.error'))
      .filter((element) => {
        if (!(element instanceof HTMLElement)) return false;
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
      })
      .map((element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim() || '页面显示失败状态'))].slice(0, 12);

    const expectedMatches = expected.filter((token) => lowerBodyText.includes(token));
    const grounded = groundedIndex >= 0
      ? document.querySelectorAll('a,button,input,select,textarea,[role="button"],[role="link"],[tabindex]').item(groundedIndex)
      : null;
    const targetDisabled = grounded instanceof HTMLButtonElement || grounded instanceof HTMLInputElement || grounded instanceof HTMLSelectElement || grounded instanceof HTMLTextAreaElement
      ? grounded.disabled
      : grounded instanceof HTMLElement
        ? grounded.getAttribute('aria-disabled') === 'true'
        : null;

    return {
      visibleText: bodyText.slice(0, 4_000),
      visibleTextLength: bodyText.length,
      nodeCount: document.body?.querySelectorAll('*').length ?? 0,
      loadingSignals: [...new Set(loading.filter(Boolean))],
      statusTexts,
      progressValues,
      expectedMatches,
      completionMarkers,
      failureSignals,
      targetDisabled,
    };
  }, { expected: tokens, groundedIndex: targetIndex });
}

export function compareTaskStateSignals(before: TaskStateSignalSnapshot, after: TaskStateSignalSnapshot): TaskStateSignalDelta {
  const progressSignals: string[] = [];
  const completionSignals: string[] = [];
  if (after.visibleTextLength > before.visibleTextLength + 2) progressSignals.push('页面可见内容增加');
  if (after.nodeCount > before.nodeCount) progressSignals.push('页面新增了内容节点');
  if (after.nodeCount < before.nodeCount && after.visibleText !== before.visibleText) progressSignals.push('页面结构收敛且可见内容发生变化');
  if (after.statusTexts.some((value) => !before.statusTexts.includes(value))) progressSignals.push('运行状态文字发生变化');
  if (after.progressValues.some((value) => !before.progressValues.includes(value))) progressSignals.push('进度数值发生变化');
  const newExpected = after.expectedMatches.filter((value) => !before.expectedMatches.includes(value));
  if (newExpected.length > 0) completionSignals.push(`出现预期结果线索：${newExpected.join('、')}`);
  const newMarkers = after.completionMarkers.filter((value) => !before.completionMarkers.includes(value));
  if (newMarkers.length > 0) completionSignals.push(`出现完成标记：${newMarkers.join('、')}`);
  if (before.loadingSignals.length > 0 && after.loadingSignals.length === 0 && after.visibleText !== before.visibleText) completionSignals.push('加载提示消失且页面结果已更新');
  if (before.targetDisabled === true && after.targetDisabled === false) completionSignals.push('操作按钮已重新启用');
  return {
    progressSignals: [...new Set(progressSignals)],
    completionSignals: [...new Set(completionSignals)],
    failureSignals: [...new Set(after.failureSignals)],
    loadingSignals: [...new Set(after.loadingSignals)],
  };
}
