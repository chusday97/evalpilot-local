import type { Page } from 'playwright';
import type { AgentActionResult, AgentDecision, PageObservation } from '../../types.js';

function targetFor(observation: PageObservation, decision: AgentDecision) {
  return observation.interactableElements.find((item) => item.elementId === decision.targetElementId) ?? null;
}

async function selectVisibleOption(locator: ReturnType<Page['locator']>, value: string): Promise<void> {
  try {
    await locator.selectOption(value);
  } catch (valueError) {
    try {
      await locator.selectOption({ label: value });
    } catch {
      throw valueError;
    }
  }
}

export async function executeAgentAction(page: Page, observation: PageObservation, decision: AgentDecision): Promise<AgentActionResult> {
  const target = targetFor(observation, decision);
  if (['click', 'fill', 'select'].includes(decision.action)) {
    if (!target) return { status: 'failed', action: decision.action, targetElementId: decision.targetElementId, summary: 'DOM 元素已经不存在，需要重新观察页面。', evidenceRefs: observation.evidenceRefs };
    if (target.disabled) return { status: 'failed', action: decision.action, targetElementId: target.elementId, summary: '目标控件当前不可用。', evidenceRefs: observation.evidenceRefs };
    if (target.risk !== 'safe') return { status: 'blocked_by_safety', action: decision.action, targetElementId: target.elementId, summary: `已阻止 ${target.risk} 风险操作。`, evidenceRefs: observation.evidenceRefs };
  }
  try {
    const index = target ? Number(target.locatorHint.split(':')[1]) : null;
    const locator = index === null ? null : page.locator('a,button,input,select,textarea,[role="button"],[role="link"],[tabindex]').filter({ visible: true }).nth(index);
    if (decision.action === 'click') await locator!.click();
    else if (decision.action === 'fill') await locator!.fill(decision.value ?? '');
    else if (decision.action === 'select') await selectVisibleOption(locator!, decision.value ?? '');
    else if (decision.action === 'scroll') await page.mouse.wheel(0, 600);
    else if (decision.action === 'back') await page.goBack({ waitUntil: 'domcontentloaded' });
    else if (decision.action === 'wait' || decision.action === 'retry') { /* bounded signal waiting is handled by the runner */ }
    return { status: 'executed', action: decision.action, targetElementId: decision.targetElementId, summary: `${decision.action} 已执行。`, evidenceRefs: observation.evidenceRefs };
  } catch (error) {
    return { status: 'failed', action: decision.action, targetElementId: decision.targetElementId, summary: error instanceof Error ? error.message : String(error), evidenceRefs: observation.evidenceRefs };
  }
}
