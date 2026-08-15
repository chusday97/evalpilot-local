import type { Page } from 'playwright';
import type { GroundedField } from '../../types.js';
import { resolveGroundedTarget } from './grounding.js';

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
  const resolution = await resolveGroundedTarget(page, field, field);
  if (resolution.status === 'drifted') throw new Error(resolution.reason);
  const locator = resolution.locator;

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
