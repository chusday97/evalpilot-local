import type { Page } from 'playwright';
import type { AgentActionResult, AgentDecision, PageObservation } from '../../types.js';
import type { SyntheticFileFixture } from '../scenario/file-fixture-resolver.js';

const groundedElementSelector = 'a,button,input,select,textarea,[role="button"],[role="link"],[tabindex]';

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

export async function executeAgentAction(page: Page, observation: PageObservation, decision: AgentDecision, options: { fileFixtures?: SyntheticFileFixture[] } = {}): Promise<AgentActionResult> {
  const target = targetFor(observation, decision);
  if (['click', 'fill', 'select'].includes(decision.action)) {
    if (!target) return { status: 'failed', action: decision.action, targetElementId: decision.targetElementId, summary: 'DOM 元素已经不存在，需要重新观察页面。', evidenceRefs: observation.evidenceRefs };
    if (target.disabled) return { status: 'failed', action: decision.action, targetElementId: target.elementId, summary: '目标控件当前不可用。', evidenceRefs: observation.evidenceRefs };
    if (target.risk !== 'safe') return { status: 'blocked_by_safety', action: decision.action, targetElementId: target.elementId, summary: `已阻止 ${target.risk} 风险操作。`, evidenceRefs: observation.evidenceRefs };
  }
  try {
    const index = target ? Number(target.locatorHint.split(':')[1]) : null;
    let locator: ReturnType<Page['locator']> | null = null;
    if (target) {
      if (!Number.isInteger(index) || index === null || index < 0) {
        return { status: 'failed', action: decision.action, targetElementId: target.elementId, summary: '目标控件缺少有效的 DOM grounding index，需要重新观察页面。', evidenceRefs: observation.evidenceRefs };
      }

      // Observer records locatorIndex from the original querySelectorAll NodeList. Do not
      // re-filter that list here: filtering visible elements creates a different index space
      // and can silently retarget an action (for example, filling an observed input may hit a
      // button when hidden/background elements precede a modal field).
      locator = page.locator(groundedElementSelector).nth(index);
      const actualTagName = await locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => null);
      if (actualTagName !== target.tagName) {
        return {
          status: 'failed',
          action: decision.action,
          targetElementId: target.elementId,
          summary: `DOM grounding 已漂移：观察到 ${target.tagName}，执行时定位到 ${actualTagName ?? 'missing'}。需要重新观察页面。`,
          evidenceRefs: observation.evidenceRefs,
        };
      }
      if (!await locator.isVisible()) {
        return { status: 'failed', action: decision.action, targetElementId: target.elementId, summary: '目标控件在执行前已不可见，需要重新观察页面。', evidenceRefs: observation.evidenceRefs };
      }
    }

    if (decision.action === 'click') await locator!.click();
    else if (decision.action === 'fill') {
      const field = observation.formFields.find((item) => item.elementId === decision.targetElementId);
      if (field?.inputType === 'file') {
        const fixture = options.fileFixtures?.find((item) => item.fixtureId === decision.value) ?? null;
        if (!fixture) return { status: 'blocked_by_safety', action: 'fill', targetElementId: decision.targetElementId, summary: '文件输入只能使用 EvalPilot 本轮生成的白名单合成 Fixture。', evidenceRefs: observation.evidenceRefs };
        await locator!.setInputFiles(fixture.path);
      } else await locator!.fill(decision.value ?? '');
    }
    else if (decision.action === 'select') await selectVisibleOption(locator!, decision.value ?? '');
    else if (decision.action === 'scroll') await page.mouse.wheel(0, 600);
    else if (decision.action === 'back') await page.goBack({ waitUntil: 'domcontentloaded' });
    else if (decision.action === 'wait' || decision.action === 'retry') { /* bounded signal waiting is handled by the runner */ }
    return { status: 'executed', action: decision.action, targetElementId: decision.targetElementId, summary: `${decision.action} 已执行。`, evidenceRefs: observation.evidenceRefs };
  } catch (error) {
    return { status: 'failed', action: decision.action, targetElementId: decision.targetElementId, summary: error instanceof Error ? error.message : String(error), evidenceRefs: observation.evidenceRefs };
  }
}
