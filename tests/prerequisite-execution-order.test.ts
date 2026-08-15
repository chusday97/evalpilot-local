import { describe, expect, it } from 'vitest';
import type { EvalCase, EvalSetType } from '../types.js';
import { orderCasesBySetupDependencies, type PrerequisitePlan } from '../src/scenario/prerequisite-planner.js';

function evalCase(caseId: string, taskId: string, setType: EvalSetType = 'baseline'): EvalCase {
  return { caseId, taskId, setType } as EvalCase;
}

function plan(caseId: string, setupTaskIds: string[]): PrerequisitePlan {
  return {
    caseId,
    status: setupTaskIds.length ? 'ready' : 'not_required',
    executionOrder: [...setupTaskIds.map(() => 'setup' as const), 'target'],
    authFixture: null,
    setupPlan: null,
    setupPlans: setupTaskIds.map((setupTaskId, index) => ({
      setupId: `setup-${caseId}-${index}`,
      targetCaseId: caseId,
      targetTaskId: `target-${caseId}`,
      setupTaskId,
      reason: 'test dependency',
      setupCase: {} as never,
      setupScenario: {} as never,
    })),
    fileFixturePlan: null,
    unresolvedBlockers: [],
    reasons: [],
  };
}

describe('prerequisite-aware case execution order', () => {
  it('runs reusable prerequisite baseline cases before their dependents', () => {
    const create = evalCase('case-create', 'task-create');
    const daily = evalCase('case-daily', 'task-daily');
    const record = evalCase('case-record', 'task-record');

    const ordered = orderCasesBySetupDependencies(
      [create, daily, record],
      [
        plan('case-create', []),
        plan('case-daily', ['task-create', 'task-record']),
        plan('case-record', ['task-create']),
      ],
    );

    expect(ordered.map((item) => item.caseId)).toEqual(['case-create', 'case-record', 'case-daily']);
  });

  it('preserves the original relative order for unrelated cases', () => {
    const first = evalCase('case-first', 'task-first');
    const second = evalCase('case-second', 'task-second');
    const third = evalCase('case-third', 'task-third');

    const ordered = orderCasesBySetupDependencies(
      [first, second, third],
      [plan('case-first', []), plan('case-second', []), plan('case-third', [])],
    );

    expect(ordered.map((item) => item.caseId)).toEqual(['case-first', 'case-second', 'case-third']);
  });

  it('does not promote a regression case as a reusable setup producer', () => {
    const dependent = evalCase('case-dependent', 'task-dependent');
    const createRegression = evalCase('case-create-regression', 'task-create', 'regression');

    const ordered = orderCasesBySetupDependencies(
      [dependent, createRegression],
      [plan('case-dependent', ['task-create']), plan('case-create-regression', [])],
    );

    expect(ordered.map((item) => item.caseId)).toEqual(['case-dependent', 'case-create-regression']);
  });

  it('fails stable on an unexpected cycle instead of inventing an order', () => {
    const first = evalCase('case-first', 'task-first');
    const second = evalCase('case-second', 'task-second');

    const ordered = orderCasesBySetupDependencies(
      [first, second],
      [plan('case-first', ['task-second']), plan('case-second', ['task-first'])],
    );

    expect(ordered.map((item) => item.caseId)).toEqual(['case-first', 'case-second']);
  });
});
