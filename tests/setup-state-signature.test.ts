import { describe, expect, it } from 'vitest';
import type { EvalCase } from '../types.js';
import type { PrerequisitePlan } from '../src/scenario/prerequisite-planner.js';
import { bindBlindSetupKnownInformation } from '../src/ux-evaluation/configured-blind-experience-runner.js';
import { buildSetupStateSignature } from '../src/ux-evaluation/setup-state-signature.js';

const now = '2026-08-16T02:15:00.000Z';

function baseline(
  caseId: string,
  knownInformation: Record<string, unknown>,
  oracle: Partial<EvalCase['oracle']> = {},
): EvalCase {
  return {
    caseId,
    projectId: 'project-signature',
    setType: 'baseline',
    status: 'stable',
    origin: { type: 'human', note: 'setup-state signature fixture' },
    capabilityId: 'cap-create',
    taskId: 'create',
    title: `Baseline ${caseId}`,
    hypothesis: 'Creates prerequisite state',
    persona: { personaId: 'persona-1', name: 'Tester', knowledgeLevel: 'low', patienceTurns: 4, retryTolerance: 1, privacySensitivity: 'medium', behaviorPolicy: [], exitConditions: [] },
    goal: 'Create prerequisite state',
    knownInformation,
    preconditions: [],
    oracle: {
      expectedOutcome: oracle.expectedOutcome ?? ['Created', 'Saved'],
      mustObserve: oracle.mustObserve ?? ['Created'],
      mustNotObserve: oracle.mustNotObserve ?? ['Error'],
      businessRules: oracle.businessRules ?? ['state persists'],
      semanticRubric: oracle.semanticRubric ?? [],
      deterministicAssertions: oracle.deterministicAssertions ?? [
        { assertionId: 'created', type: 'text_visible', target: 'Created', expected: true, negated: false },
        { assertionId: 'persisted', type: 'state_persisted', target: 'item', expected: true, negated: false },
      ],
      inconclusiveWhen: oracle.inconclusiveWhen ?? [],
    },
    coverageDimensions: [],
    riskLevel: 'P1',
    generationReason: 'signature test',
    version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 1, lastExecutedAt: null },
    regressionMetadata: null,
    retirementReason: null,
    needsHumanReview: false,
    createdAt: now,
    updatedAt: now,
  };
}

function plan(): PrerequisitePlan {
  const ephemeral = baseline('ephemeral-create', {});
  const setupStep = {
    setupId: 'setup-create',
    targetCaseId: 'target-record',
    targetTaskId: 'record',
    setupTaskId: 'create',
    setupCase: { ...ephemeral, setType: 'exploratory' as const },
    setupScenario: {
      scenarioId: 'scenario-create', projectId: 'project-signature', caseId: 'ephemeral-create',
      capabilityId: 'cap-create', taskId: 'create', goal: 'Create prerequisite state',
      startingUrl: 'http://127.0.0.1:3000/', readiness: 'ready' as const,
      blockers: [], preconditions: [], knownInformationKeys: [], generatedAt: now,
    },
    reason: 'verified setup',
  };
  return {
    caseId: 'target-record', status: 'ready', executionOrder: ['setup', 'target'],
    authFixture: null, setupPlans: [setupStep], setupPlan: setupStep,
    fileFixturePlan: null, unresolvedBlockers: [], reasons: [],
  };
}

describe('setup-state exact signature', () => {
  it('is stable across object-key ordering, Oracle list ordering, and assertion metadata IDs', () => {
    const first = baseline('baseline-a', { waterType: 'freshwater', dimensions: { length: 60, width: 30 } });
    const second = baseline(
      'baseline-b',
      { dimensions: { width: 30, length: 60 }, waterType: 'freshwater' },
      {
        expectedOutcome: ['Saved', 'Created'],
        mustObserve: ['Created'],
        mustNotObserve: ['Error'],
        businessRules: ['state persists'],
        deterministicAssertions: [...first.oracle.deterministicAssertions].reverse().map((assertion, index) => ({ ...assertion, assertionId: `copy-${index + 1}` })),
      },
    );

    expect(buildSetupStateSignature(second).fingerprint).toBe(buildSetupStateSignature(first).fingerprint);
  });

  it('changes when fixture state changes', () => {
    const freshwater = baseline('freshwater', { waterType: 'freshwater', lengthCm: 60 });
    const saltwater = baseline('saltwater', { waterType: 'saltwater', lengthCm: 60 });
    expect(buildSetupStateSignature(freshwater).fingerprint).not.toBe(buildSetupStateSignature(saltwater).fingerprint);
  });

  it('changes when the observable result contract changes', () => {
    const created = baseline('created', { waterType: 'freshwater' });
    const differentAssertion = baseline('different-assertion', { waterType: 'freshwater' }, {
      deterministicAssertions: [
        { assertionId: 'created', type: 'text_visible', target: 'Different state', expected: true, negated: false },
      ],
    });
    expect(buildSetupStateSignature(created).fingerprint).not.toBe(buildSetupStateSignature(differentAssertion).fingerprint);
  });

  it('reuses exact-equivalent duplicate baselines and selects by stable caseId order', () => {
    const state = { waterType: 'freshwater', dimensions: { length: 60, width: 30 } };
    const later = baseline('baseline-z', state);
    const earlier = baseline('baseline-a', { dimensions: { width: 30, length: 60 }, waterType: 'freshwater' });
    const result = bindBlindSetupKnownInformation(plan(), [later, earlier]);

    expect(result.missingTaskIds).toEqual([]);
    expect(result.sources[0]).toEqual(expect.objectContaining({
      sourceCaseId: 'baseline-a',
      candidateCaseIds: ['baseline-a', 'baseline-z'],
      equivalence: 'exact_signature_match',
      status: 'ready',
    }));
    expect(result.sources[0]?.setupStateFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(new Set(result.sources[0]?.candidateStateFingerprints.map((item) => item.fingerprint)).size).toBe(1);
    expect(result.plan.setupPlans[0]?.setupCase.knownInformation).toEqual(earlier.knownInformation);
  });

  it('still fails closed when multiple baselines have different result contracts', () => {
    const first = baseline('baseline-a', { waterType: 'freshwater' });
    const second = baseline('baseline-b', { waterType: 'freshwater' }, {
      expectedOutcome: ['Created in a different mode'],
    });
    const result = bindBlindSetupKnownInformation(plan(), [first, second]);

    expect(result.missingTaskIds).toEqual(['create']);
    expect(result.sources[0]).toEqual(expect.objectContaining({
      sourceCaseId: null,
      equivalence: 'ambiguous',
      status: 'missing_baseline',
    }));
    expect(new Set(result.sources[0]?.candidateStateFingerprints.map((item) => item.fingerprint)).size).toBe(2);
    expect(result.sources[0]?.reason).toContain('多个不等价 setup-state signature');
  });
});
