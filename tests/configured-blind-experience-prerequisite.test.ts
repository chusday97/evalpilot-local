import { describe, expect, it } from 'vitest';
import type { EvalCase } from '../types.js';
import type { PrerequisitePlan } from '../src/scenario/prerequisite-planner.js';
import { bindBlindSetupKnownInformation } from '../src/ux-evaluation/configured-blind-experience-runner.js';

function baseline(caseId: string, taskId: string, knownInformation: Record<string, unknown>): EvalCase {
  return {
    caseId,
    projectId: 'project-1',
    setType: 'baseline',
    status: 'stable',
    origin: { type: 'human', note: 'approved baseline fixture' },
    capabilityId: `cap-${taskId}`,
    taskId,
    title: `Baseline ${taskId}`,
    hypothesis: 'setup producer',
    persona: {
      personaId: 'persona-1', name: 'Tester', knowledgeLevel: 'low', patienceTurns: 4,
      retryTolerance: 1, privacySensitivity: 'medium', behaviorPolicy: [], exitConditions: [],
    },
    goal: `complete ${taskId}`,
    knownInformation,
    preconditions: [],
    oracle: {
      expectedOutcome: ['done'], mustObserve: [], mustNotObserve: [], businessRules: [], semanticRubric: [],
      deterministicAssertions: [], inconclusiveWhen: [],
    },
    coverageDimensions: [],
    riskLevel: 'P1',
    generationReason: 'test',
    version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 1, lastExecutedAt: null },
    regressionMetadata: null,
    retirementReason: null,
    needsHumanReview: false,
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
  };
}

function setupStep(taskId: string) {
  return {
    setupId: `setup-${taskId}`,
    targetCaseId: 'target-record',
    targetTaskId: 'record',
    setupTaskId: taskId,
    setupCase: { ...baseline(`ephemeral-${taskId}`, taskId, {}), setType: 'exploratory' as const },
    setupScenario: {
      scenarioId: `scenario-${taskId}`, projectId: 'project-1', caseId: `ephemeral-${taskId}`,
      capabilityId: `cap-${taskId}`, taskId, goal: `complete ${taskId}`,
      startingUrl: 'http://127.0.0.1:3000/', readiness: 'ready' as const,
      blockers: [], preconditions: [], knownInformationKeys: [], generatedAt: '2026-08-15T00:00:00.000Z',
    },
    reason: 'verified setup',
  };
}

function plan(steps: ReturnType<typeof setupStep>[]): PrerequisitePlan {
  const final = steps.at(-1) ?? null;
  return {
    caseId: 'target-record',
    status: steps.length ? 'ready' : 'not_required',
    executionOrder: steps.length ? [...steps.map(() => 'setup' as const), 'target'] : ['target'],
    authFixture: null,
    setupPlans: steps,
    setupPlan: final ? (steps.length === 1 ? final : { ...final, setupId: 'setup-chain-target-record', chainSteps: steps }) : null,
    fileFixturePlan: null,
    unresolvedBlockers: [],
    reasons: [],
  };
}

describe('configured Blind Experience prerequisite binding', () => {
  it('hydrates evaluator-managed Setup only from a stable baseline producer', () => {
    const source = baseline('baseline-create', 'create', { lengthCm: 60, widthCm: 30, heightCm: 30, waterType: 'freshwater' });
    const target = baseline('target-record', 'record', { scientificName: 'Corydoras aeneus', quantity: 1 });
    const result = bindBlindSetupKnownInformation(plan([setupStep('create')]), [source, target]);

    expect(result.missingTaskIds).toEqual([]);
    expect(result.sources).toEqual([expect.objectContaining({ setupTaskId: 'create', sourceCaseId: 'baseline-create', candidateCaseIds: ['baseline-create'], status: 'ready' })]);
    expect(result.plan.setupPlans[0]?.setupCase.knownInformation).toEqual(source.knownInformation);
    expect(result.plan.setupPlans[0]?.setupCase.knownInformation).not.toBe(source.knownInformation);
  });

  it('fails closed when a required Setup task has no reusable baseline case', () => {
    const target = baseline('target-record', 'record', { scientificName: 'Corydoras aeneus', quantity: 1 });
    const result = bindBlindSetupKnownInformation(plan([setupStep('create')]), [target]);

    expect(result.missingTaskIds).toEqual(['create']);
    expect(result.sources[0]).toEqual(expect.objectContaining({ sourceCaseId: null, candidateCaseIds: [], status: 'missing_baseline' }));
    expect(result.plan.setupPlans[0]?.setupCase.knownInformation).toEqual({});
  });

  it('fails closed rather than arbitrarily choosing among multiple stable Setup baselines', () => {
    const freshwater = baseline('baseline-create-freshwater', 'create', { waterType: 'freshwater', lengthCm: 60 });
    const saltwater = baseline('baseline-create-saltwater', 'create', { waterType: 'saltwater', lengthCm: 60 });
    const target = baseline('target-record', 'record', { scientificName: 'Corydoras aeneus', quantity: 1 });
    const result = bindBlindSetupKnownInformation(plan([setupStep('create')]), [freshwater, saltwater, target]);

    expect(result.missingTaskIds).toEqual(['create']);
    expect(result.sources[0]).toEqual(expect.objectContaining({
      sourceCaseId: null,
      candidateCaseIds: ['baseline-create-freshwater', 'baseline-create-saltwater'],
      status: 'missing_baseline',
    }));
    expect(result.sources[0]?.reason).toContain('当前无法证明这些状态等价');
    expect(result.plan.setupPlans[0]?.setupCase.knownInformation).toEqual({});
  });

  it('preserves ordered setup chains while binding each approved producer independently', () => {
    const create = baseline('baseline-create', 'create', { size: '60x30x30', waterType: 'freshwater' });
    const stock = baseline('baseline-stock', 'stock', { scientificName: 'Corydoras aeneus', quantity: 1 });
    const target = baseline('target-daily', 'daily', { respiration: '经常浮头' });
    const result = bindBlindSetupKnownInformation(plan([setupStep('create'), setupStep('stock')]), [create, stock, target]);

    expect(result.missingTaskIds).toEqual([]);
    expect(result.plan.setupPlan?.chainSteps?.map((step) => step.setupTaskId)).toEqual(['create', 'stock']);
    expect(result.plan.setupPlan?.chainSteps?.[0]?.setupCase.knownInformation).toEqual(create.knownInformation);
    expect(result.plan.setupPlan?.chainSteps?.[1]?.setupCase.knownInformation).toEqual(stock.knownInformation);
  });
});
