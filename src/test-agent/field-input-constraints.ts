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

function finiteNumber(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value: number): number | null {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export async function readFieldInputConstraints(page: Page, field: GroundedField): Promise<FieldInputConstraints> {
  const index = Number(field.locatorHint.split(':')[1]);
  if (!Number.isInteger(index) || index < 0) return { min: null, max: null, minLength: null, maxLength: null, step: null, pattern: null };
  const locator = page.locator('a,button,input,select,textarea,[role="button"],[role="link"],[tabindex]').filter({ visible: true }).nth(index);
  return locator.evaluate((node) => {
    const element = node as HTMLInputElement | HTMLTextAreaElement;
    const readNumber = (name: string): number | null => {
      const raw = element.getAttribute(name);
      if (raw === null || raw.trim() === '') return null;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const readLength = (name: 'minlength' | 'maxlength'): number | null => {
      const value = readNumber(name);
      return value !== null && Number.isInteger(value) && value >= 0 ? value : null;
    };
    return {
      min: readNumber('min'),
      max: readNumber('max'),
      minLength: readLength('minlength'),
      maxLength: readLength('maxlength'),
      step: readNumber('step'),
      pattern: element.getAttribute('pattern'),
    };
  }).then((value) => ({
    min: finiteNumber(value.min === null ? null : String(value.min)),
    max: finiteNumber(value.max === null ? null : String(value.max)),
    minLength: value.minLength === null ? null : integer(value.minLength),
    maxLength: value.maxLength === null ? null : integer(value.maxLength),
    step: finiteNumber(value.step === null ? null : String(value.step)),
    pattern: value.pattern,
  }));
}
