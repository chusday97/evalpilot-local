import type { Locator, Page } from 'playwright';
import type { GroundedElement, GroundedField } from '../../types.js';

export const groundedElementSelector = 'a,button,input,select,textarea,[role="button"],[role="link"],[tabindex]';

interface LiveGroundingIdentity {
  tagName: string;
  role: string | null;
  label: string;
  placeholder: string | null;
  fieldName: string | null;
  inputType: string;
}

export type GroundedTargetResolution =
  | { status: 'ready'; locator: Locator }
  | { status: 'drifted'; reason: string };

function normalized(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function identityDescription(identity: { tagName: string; label: string; inputType?: string; fieldName?: string | null }): string {
  const details = [identity.inputType ? `type=${identity.inputType}` : null, identity.fieldName ? `name=${identity.fieldName}` : null].filter(Boolean).join(', ');
  return `${identity.tagName}「${identity.label}」${details ? ` (${details})` : ''}`;
}

async function readLiveIdentity(locator: Locator): Promise<LiveGroundingIdentity | null> {
  return locator.evaluate((node) => {
    if (!(node instanceof HTMLElement)) return null;
    const element = node;
    const input = node as HTMLInputElement;
    const labels: string[] = [];
    if ('labels' in input && input.labels) {
      for (let index = 0; index < input.labels.length; index += 1) {
        const labelNode = input.labels.item(index);
        const value = labelNode?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        if (value) labels.push(value);
      }
    }
    const ariaLabel = element.getAttribute('aria-label');
    const text = element.textContent?.replace(/\s+/g, ' ').trim().slice(0, 240) || null;
    const placeholder = element.getAttribute('placeholder');
    const fieldName = element.getAttribute('name');
    const tagName = element.tagName.toLowerCase();
    const rawLabel = ariaLabel ?? labels.join(' ');
    return {
      tagName,
      role: element.getAttribute('role'),
      label: rawLabel || text || placeholder || fieldName || tagName,
      placeholder,
      fieldName,
      inputType: input.type || tagName,
    };
  }).catch(() => null);
}

export async function resolveGroundedTarget(page: Page, target: GroundedElement, field?: GroundedField | null): Promise<GroundedTargetResolution> {
  const index = Number(target.locatorHint.split(':')[1]);
  if (!Number.isInteger(index) || index < 0) {
    return { status: 'drifted', reason: '目标控件缺少有效的 DOM grounding index，需要重新观察页面。' };
  }

  // Keep exactly the Observer index space; validate semantic identity before acting.
  const locator = page.locator(groundedElementSelector).nth(index);
  const live = await readLiveIdentity(locator);
  if (!live) {
    return { status: 'drifted', reason: `DOM grounding 已漂移：观察到 ${identityDescription(target)}，执行时相同索引已不存在。需要重新观察页面。` };
  }

  const mismatches: string[] = [];
  if (live.tagName !== target.tagName) mismatches.push(`tag ${target.tagName}→${live.tagName}`);
  if (normalized(live.label) !== normalized(target.label)) mismatches.push(`label ${target.label}→${live.label}`);
  if (live.role !== target.role) mismatches.push(`role ${target.role ?? 'none'}→${live.role ?? 'none'}`);
  if (field) {
    if (live.inputType !== field.inputType) mismatches.push(`type ${field.inputType}→${live.inputType}`);
    if (live.fieldName !== field.fieldName) mismatches.push(`name ${field.fieldName ?? 'none'}→${live.fieldName ?? 'none'}`);
    if (live.placeholder !== field.placeholder) mismatches.push(`placeholder ${field.placeholder ?? 'none'}→${live.placeholder ?? 'none'}`);
  }

  if (mismatches.length) {
    const expected = field
      ? identityDescription({ tagName: target.tagName, label: target.label, inputType: field.inputType, fieldName: field.fieldName })
      : identityDescription(target);
    const actual = identityDescription(live);
    return {
      status: 'drifted',
      reason: `DOM grounding 已漂移：观察到 ${expected}，执行时相同索引变为 ${actual}。差异：${mismatches.join('；')}。需要重新观察页面。`,
    };
  }

  if (!await locator.isVisible().catch(() => false)) {
    return { status: 'drifted', reason: '目标控件在执行前已不可见，需要重新观察页面。' };
  }
  return { status: 'ready', locator };
}
