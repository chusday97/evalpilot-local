import { describe, expect, it, vi } from 'vitest';
import type { GroundedField, PageObservation } from '../types.js';
import { executeAgentAction } from '../src/test-agent/action-executor.js';
import { readFieldInputConstraints } from '../src/test-agent/field-input-constraints.js';
import { generateSafeInput } from '../src/test-agent/safe-input-generator.js';

function field(overrides: Partial<GroundedField> = {}): GroundedField {
  return {
    elementId: 'E001',
    role: null,
    tagName: 'input',
    label: 'Volume',
    text: null,
    placeholder: null,
    disabled: false,
    risk: 'safe',
    locatorHint: 'grounded-index:0',
    fieldName: 'volume',
    inputType: 'number',
    required: true,
    currentValuePresent: false,
    options: [],
    ...overrides,
  };
}

describe('task-aware safe input', () => {
  it('keeps a valid Actor-proposed number instead of replacing it with 1', () => {
    const result = generateSafeInput(field(), {}, 'http://127.0.0.1:3000', '60');
    expect(result).toMatchObject({ status: 'ready', value: '60' });
    expect(result.reason).toContain('Actor');
  });

  it('keeps Case knownInformation ahead of the Actor proposal', () => {
    const result = generateSafeInput(field(), { volume: 80 }, 'http://127.0.0.1:3000', '60');
    expect(result).toMatchObject({ status: 'ready', value: '80', origin: 'known_fixture' });
  });

  it('falls back to a safe synthetic value when the Actor proposes an invalid number', () => {
    const result = generateSafeInput(field(), {}, 'http://127.0.0.1:3000', 'sixty litres');
    expect(result).toMatchObject({ status: 'ready', value: '1', origin: 'synthetic_generated' });
    expect(result.reason).toContain('未通过');
  });

  it('never lets an Actor proposal bypass a sensitive-field block', () => {
    const result = generateSafeInput(field({ fieldName: 'password', label: 'Password', inputType: 'password', risk: 'sensitive' }), {}, 'http://127.0.0.1:3000', 'safe-looking-value');
    expect(result).toMatchObject({ status: 'blocked_by_safety', value: null });
  });

  it('does not accept remote email proposals', () => {
    const result = generateSafeInput(field({ fieldName: 'email', label: 'Email', inputType: 'email' }), {}, 'https://example.com', 'demo@example.com');
    expect(result).toMatchObject({ status: 'blocked_by_safety', value: null });
  });

  it('rejects an out-of-range Actor value and generates a legal number', () => {
    const result = generateSafeInput(field(), {}, 'http://127.0.0.1:3000', '60', { min: 20, max: 50, minLength: null, maxLength: null, step: 5, pattern: null });
    expect(result).toMatchObject({ status: 'ready', value: '20', origin: 'synthetic_generated' });
  });

  it('does not let invalid knownInformation override a valid Actor value', () => {
    const result = generateSafeInput(field(), { volume: 80 }, 'http://127.0.0.1:3000', '40', { min: 20, max: 50, minLength: null, maxLength: null, step: 5, pattern: null });
    expect(result).toMatchObject({ status: 'ready', value: '40' });
  });

  it('fits synthetic text to basic minlength and maxlength constraints', () => {
    const result = generateSafeInput(field({ fieldName: 'name', label: 'Name', inputType: 'text' }), {}, 'http://127.0.0.1:3000', null, { min: null, max: null, minLength: 5, maxLength: 8, step: null, pattern: null });
    expect(result.status).toBe('ready');
    expect(result.value?.length).toBeGreaterThanOrEqual(5);
    expect(result.value?.length).toBeLessThanOrEqual(8);
  });
});

describe('live field constraints', () => {
  it('reads min/max/step and length constraints from the grounded DOM element', async () => {
    const evaluate = vi.fn()
      .mockResolvedValueOnce({ tagName: 'input', role: null, label: 'Volume', placeholder: null, fieldName: 'volume', inputType: 'number' })
      .mockResolvedValueOnce({ min: 20, max: 50, minLength: 3, maxLength: 8, step: 5, pattern: '[0-9]+' });
    const locator = { nth: vi.fn().mockReturnThis(), evaluate, isVisible: vi.fn().mockResolvedValue(true) };
    const page = { locator: vi.fn(() => locator) } as any;
    const constraints = await readFieldInputConstraints(page, field());
    expect(constraints).toEqual({ min: 20, max: 50, minLength: 3, maxLength: 8, step: 5, pattern: '[0-9]+' });
  });
});

describe('select action compatibility', () => {
  it('falls back from option value matching to the visible option label', async () => {
    const selectOption = vi.fn()
      .mockRejectedValueOnce(new Error('value not found'))
      .mockResolvedValueOnce(undefined);
    const locator = {
      nth: vi.fn().mockReturnThis(),
      evaluate: vi.fn().mockResolvedValue({ tagName: 'select', role: null, label: 'Water type', placeholder: null, fieldName: 'volume', inputType: 'select-one' }),
      isVisible: vi.fn().mockResolvedValue(true),
      selectOption,
    };
    const page = { locator: vi.fn(() => locator) } as any;
    const observation: PageObservation = {
      observationId: 'observation-select',
      pageUrl: 'http://127.0.0.1:3000',
      pagePurpose: 'Form',
      visibleStateSummary: 'Choose water type',
      primaryAreas: [],
      visibleProblems: [],
      interactableElements: [field({ tagName: 'select', inputType: 'select-one', label: 'Water type', options: ['123', 'Freshwater'] })],
      formFields: [field({ tagName: 'select', inputType: 'select-one', label: 'Water type', options: ['123', 'Freshwater'] })],
      evidenceRefs: [],
      confidence: 1,
    };
    const result = await executeAgentAction(page, observation, {
      decisionId: 'decision-select',
      intentSummary: '选择淡水',
      action: 'select',
      targetElementId: 'E001',
      value: 'Freshwater',
      expectedResult: 'Freshwater selected',
      confidence: 1,
    });
    expect(result.status).toBe('executed');
    expect(selectOption).toHaveBeenNthCalledWith(1, 'Freshwater');
    expect(selectOption).toHaveBeenNthCalledWith(2, { label: 'Freshwater' });
  });
});
