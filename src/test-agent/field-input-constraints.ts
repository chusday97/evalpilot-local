import type { Page } from 'playwright';
import type { GroundedField } from '../../types.js';

export interface FieldInputConstraints {
  min: number | null;
  max: number | null;
  minLength: number | null;
  maxLength: number | null;
  step: number | null;
  pattern: string | null;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value: number | null): number | null {
  return value !== null && Number.isInteger(value) && value >= 0 ? value : null;
}

export async function readFieldInputConstraints(page: Page, field: GroundedField): Promise<FieldInputConstraints> {
  const index = Number(field.locatorHint.split(':')[1]);
  if (!Number.isInteger(index) || index < 0) return { min: null, max: null, minLength: null, maxLength: null, step: null, pattern: null };

  // locatorHint is the index from Observer's original querySelectorAll NodeList.
  // Re-filtering to visible elements here would create a different index space and
  // could read constraints from the wrong element when hidden/background controls
  // precede a modal field.
  const locator = page.locator('a,button,input,select,textarea,[role="button"],[role="link"],[tabindex]').nth(index);

  // Keep the browser-evaluated callback self-contained and free of nested helpers.
  // Transpilers may inject helper references such as `__name` for nested functions;
  // those helpers do not exist inside Playwright's browser execution context.
  const attributes = await locator.evaluate((node) => {
    const element = node as HTMLElement;
    return {
      min: element.getAttribute('min'),
      max: element.getAttribute('max'),
      minLength: element.getAttribute('minlength'),
      maxLength: element.getAttribute('maxlength'),
      step: element.getAttribute('step'),
      pattern: element.getAttribute('pattern'),
    };
  });

  return {
    min: finiteNumber(attributes.min),
    max: finiteNumber(attributes.max),
    minLength: integer(finiteNumber(attributes.minLength)),
    maxLength: integer(finiteNumber(attributes.maxLength)),
    step: finiteNumber(attributes.step),
    pattern: typeof attributes.pattern === 'string' ? attributes.pattern : null,
  };
}
