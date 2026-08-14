import type { Page } from 'playwright';
import type { GroundedElement, GroundedField, PageObservation } from '../../types.js';
import { pageObservationSchema } from './schemas.js';

interface RawElement {
  tagName: string;
  role: string | null;
  label: string;
  text: string | null;
  placeholder: string | null;
  disabled: boolean;
  fieldName: string | null;
  inputType: string;
  required: boolean;
  currentValuePresent: boolean;
  options: string[];
}

interface RawPageSample {
  title: string;
  headings: string[];
  visibleText: string;
  raw: RawElement[];
}

const highRiskPattern = /\b(delete|remove|erase|publish|deploy|purchase|pay|send|submit order|confirm order|account deletion)\b|删除|移除|发布|部署|购买|付款|发送|注销/i;
const sensitivePattern = /password|passcode|credential|secret|token|credit|card|cvv|ssn|密码|密钥|令牌|信用卡|身份证/i;

function riskFor(element: RawElement): GroundedElement['risk'] {
  const description = [element.label, element.text, element.placeholder, element.fieldName, element.inputType].filter(Boolean).join(' ');
  if (highRiskPattern.test(description)) return 'high';
  if (sensitivePattern.test(description) || element.inputType === 'password') return 'sensitive';
  return 'safe';
}

export async function observePage(page: Page, evidenceRefs: string[] = [], observationId = 'observation-standalone'): Promise<PageObservation> {
  const sample = await page.evaluate((): RawPageSample => {
    // IMPORTANT: keep this browser-serialized callback free of nested function declarations
    // and callback helpers. EvalPilot often runs from source through tsx/esbuild; keep-name
    // transforms can inject Node-side `__name(...)` helpers that do not exist in the page.
    const headings: string[] = [];
    const headingNodes = document.querySelectorAll('h1,h2,h3');
    for (const headingNode of headingNodes) {
      const text = (headingNode as HTMLElement).innerText.trim();
      if (text) headings.push(text);
    }

    const raw: RawElement[] = [];
    const nodes = document.querySelectorAll('a,button,input,select,textarea,[role="button"],[role="link"],[tabindex]');
    for (const node of nodes) {
      const element = node as HTMLElement;
      const style = window.getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none' || element.getClientRects().length === 0) continue;

      const input = node as HTMLInputElement;
      const select = node as HTMLSelectElement;
      const labels: string[] = [];
      if ('labels' in input && input.labels) {
        for (let index = 0; index < input.labels.length; index += 1) {
          const labelNode = input.labels.item(index);
          const value = labelNode?.textContent?.trim() ?? '';
          if (value) labels.push(value);
        }
      }

      const options: string[] = [];
      if (element.tagName === 'SELECT') {
        const seen = new Set<string>();
        for (let index = 0; index < select.options.length; index += 1) {
          const option = select.options.item(index);
          if (!option) continue;
          const value = option.value.trim();
          const text = option.text.trim();
          if (value && !seen.has(value)) {
            seen.add(value);
            options.push(value);
          }
          if (text && !seen.has(text)) {
            seen.add(text);
            options.push(text);
          }
        }
      }

      const ariaLabel = element.getAttribute('aria-label');
      raw.push({
        tagName: element.tagName.toLowerCase(),
        role: element.getAttribute('role'),
        label: ariaLabel ?? labels.join(' '),
        text: element.textContent?.replace(/\s+/g, ' ').trim().slice(0, 240) || null,
        placeholder: element.getAttribute('placeholder'),
        disabled: 'disabled' in input ? Boolean(input.disabled) : element.getAttribute('aria-disabled') === 'true',
        fieldName: element.getAttribute('name'),
        inputType: input.type || element.tagName.toLowerCase(),
        required: 'required' in input ? Boolean(input.required) : false,
        currentValuePresent: 'value' in input ? String(input.value ?? '').length > 0 : false,
        options,
      });
    }

    return {
      title: document.title,
      headings,
      visibleText: (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 4_000),
      raw,
    };
  }).catch((): RawPageSample => ({ title: '', headings: [], visibleText: '', raw: [] }));

  const interactableElements: GroundedElement[] = sample.raw.map((item, index) => ({
    elementId: `E${String(index + 1).padStart(3, '0')}`,
    role: item.role,
    tagName: item.tagName,
    label: item.label || item.text || item.placeholder || item.fieldName || item.tagName,
    text: item.text,
    placeholder: item.placeholder,
    disabled: item.disabled,
    risk: riskFor(item),
    locatorHint: `grounded-index:${index}`,
  }));
  const formFields: GroundedField[] = sample.raw.flatMap((item, index) => ['input', 'select', 'textarea'].includes(item.tagName) ? [{
    ...interactableElements[index]!,
    fieldName: item.fieldName,
    inputType: item.inputType,
    required: item.required,
    currentValuePresent: item.currentValuePresent,
    options: item.options,
  }] : []);
  return pageObservationSchema.parse({
    observationId,
    pageUrl: page.url(),
    pagePurpose: sample.headings[0] ?? sample.title,
    visibleStateSummary: sample.visibleText,
    primaryAreas: sample.headings.slice(0, 8),
    visibleProblems: [/error|failed|unavailable|错误|失败|不可用/i.test(sample.visibleText) ? '页面显示错误或不可用状态' : null].filter((item): item is string => item !== null),
    interactableElements,
    formFields,
    evidenceRefs,
    confidence: sample.visibleText || interactableElements.length ? 0.95 : 0.4,
  });
}
