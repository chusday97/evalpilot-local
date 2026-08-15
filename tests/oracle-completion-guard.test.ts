import { describe, expect, it, vi } from 'vitest';
import { chooseAgentAction } from '../src/test-agent/actor.js';

function baseCase(assertions: any[]) {
  return {
    caseId: 'case-oracle-guard',
    oracle: {
      deterministicAssertions: assertions,
      expectedOutcome: [],
      mustObserve: [],
      mustNotObserve: [],
      businessRules: [],
      semanticRubric: [],
      inconclusiveWhen: [],
    },
  } as any;
}

function observation(text: string, url = 'http://127.0.0.1/result', interactableElements: any[] = []) {
  return {
    observationId: 'obs-1',
    pageUrl: url,
    pagePurpose: 'Result',
    visibleStateSummary: text,
    primaryAreas: [],
    visibleProblems: [],
    interactableElements,
    formFields: [],
    evidenceRefs: [],
    confidence: 1,
  } as any;
}

function button(label: string) {
  return {
    elementId: 'E-save',
    role: null,
    tagName: 'button',
    label,
    text: label,
    placeholder: null,
    disabled: false,
    risk: 'safe',
    locatorHint: 'grounded-index:0',
  } as any;
}

function input(evalCase: any, currentObservation: any, provider: any, progressed = false) {
  return {
    provider,
    evalCase,
    observation: currentObservation,
    history: progressed ? [{ intentSummary: '保存', action: 'click', targetElementId: 'E001', value: null, expectedResult: 'saved', confidence: 1 }] : [],
    verifications: progressed ? [{ verificationId: 'v1', expectation: 'saved', observed: 'saved', status: 'confirmed', evidenceRefs: [], confidence: 1 }] : [],
    progress: { currentFocus: 'task', remainingExpectedSignals: [], completedVerifiedSteps: progressed ? 1 : 0, remainingBudget: 8, failedAttempts: 0 },
    screenshotDataUrl: null,
    allowRemoteModel: true,
    allowScreenshot: false,
  } as any;
}

describe('Actor deterministic completion guard', () => {
  it('finishes without calling the model after verified progress when all immediate assertions pass', async () => {
    const generateStructured = vi.fn(() => { throw new Error('provider should not be called'); });
    const provider = { info: { remote: true }, generateStructured } as any;
    const evalCase = baseCase([
      { assertionId: 'a1', type: 'text_visible', target: '1 species · 1 total', negated: false },
      { assertionId: 'a2', type: 'url_matches', target: '/result', negated: false },
    ]);

    const decision = await chooseAgentAction(input(evalCase, observation('Livestock in Tank 1 species · 1 total'), provider, true));

    expect(decision.action).toBe('finish');
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it('does not auto-finish from the initial page even when Oracle text is already present', async () => {
    const generateStructured = vi.fn(async () => ({ intentSummary: '执行真实动作', action: 'wait', targetElementId: null, value: null, expectedResult: '继续', confidence: 1 }));
    const provider = { info: { remote: true }, generateStructured } as any;
    const evalCase = baseCase([{ assertionId: 'a1', type: 'text_visible', target: 'Imported', negated: false }]);

    const decision = await chooseAgentAction(input(evalCase, observation('Example: Imported file will appear here'), provider));

    expect(decision.action).toBe('wait');
    expect(generateStructured).toHaveBeenCalledOnce();
  });

  it('does not auto-finish when even one immediate assertion is still missing', async () => {
    const generateStructured = vi.fn(async () => ({ intentSummary: '继续', action: 'wait', targetElementId: null, value: null, expectedResult: '继续等待', confidence: 1 }));
    const provider = { info: { remote: true }, generateStructured } as any;
    const evalCase = baseCase([
      { assertionId: 'a1', type: 'text_visible', target: 'saved', negated: false },
      { assertionId: 'a2', type: 'text_visible', target: 'missing', negated: false },
    ]);

    const decision = await chooseAgentAction(input(evalCase, observation('saved'), provider, true));

    expect(decision.action).toBe('wait');
    expect(generateStructured).toHaveBeenCalledOnce();
  });

  it('does not auto-finish assertions that require packet-level evidence', async () => {
    const generateStructured = vi.fn(async () => ({ intentSummary: '继续', action: 'wait', targetElementId: null, value: null, expectedResult: '继续等待', confidence: 1 }));
    const provider = { info: { remote: true }, generateStructured } as any;
    const evalCase = baseCase([
      { assertionId: 'a1', type: 'request_observed', target: '/api/save', negated: false },
    ]);

    const decision = await chooseAgentAction(input(evalCase, observation('Saved'), provider, true));

    expect(decision.action).toBe('wait');
    expect(generateStructured).toHaveBeenCalledOnce();
  });

  it('does not auto-finish a matching preview while an explicit Save control is still pending', async () => {
    const generateStructured = vi.fn(async () => ({ intentSummary: '提交设置', action: 'click', targetElementId: 'E-save', value: null, expectedResult: '设置被真正保存', confidence: 1 }));
    const provider = { info: { remote: true }, generateStructured } as any;
    const evalCase = baseCase([
      { assertionId: 'a1', type: 'text_visible', target: '60x30x30cm', negated: false },
      { assertionId: 'a2', type: 'text_visible', target: 'Freshwater', negated: false },
    ]);

    const decision = await chooseAgentAction(input(
      evalCase,
      observation('Tank Settings 60x30x30cm Freshwater Save Settings', 'http://127.0.0.1/aquarium', [button('Save Settings')]),
      provider,
      true,
    ));

    expect(decision.action).toBe('click');
    expect(decision.targetElementId).toBe('E-save');
    expect(generateStructured).toHaveBeenCalledOnce();
  });

  it('does not auto-finish a livestock preview while 保存到鱼缸 is still pending', async () => {
    const generateStructured = vi.fn(async () => ({ intentSummary: '保存记录', action: 'click', targetElementId: 'E-save', value: null, expectedResult: '记录持久化', confidence: 1 }));
    const provider = { info: { remote: true }, generateStructured } as any;
    const evalCase = baseCase([{ assertionId: 'a1', type: 'text_visible', target: 'Corydoras aeneus x 1', negated: false }]);

    const decision = await chooseAgentAction(input(
      evalCase,
      observation('将记录：Corydoras aeneus x 1 保存到鱼缸', 'http://127.0.0.1/aquarium/record', [button('保存到鱼缸')]),
      provider,
      true,
    ));

    expect(decision.action).toBe('click');
    expect(generateStructured).toHaveBeenCalledOnce();
  });
});
