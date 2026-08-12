import { describe, expect, it, vi } from 'vitest';
import type { GroundedField, PageObservation } from '../types.js';
import { executeAgentAction } from '../src/test-agent/action-executor.js';
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
});

describe('select action compatibility', () => {
  it('falls back from option value matching to the visible option label', async () => {
    const selectOption = vi.fn()
      .mockRejectedValueOnce(new Error('value not found'))
      .mockResolvedValueOnce(undefined);
    const locator = { filter: vi.fn().mockReturnThis(), nth: vi.fn().mockReturnThis(), selectOption };
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
