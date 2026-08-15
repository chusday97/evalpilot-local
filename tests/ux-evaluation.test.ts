import { describe, expect, it } from 'vitest';
import type {
  BlueprintCapability,
  CompletionDefinition,
  EvalBlueprint,
  FeatureJourneyGraph,
  InteractionAction,
  Persona,
} from '../types.js';
import { buildPersonas } from '../src/generation/persona-builder.js';
import { exploratoryScenarioSchema } from '../src/schemas/ux-evaluation.js';
import { analyzeAbandonment } from '../src/ux-evaluation/abandonment-detector.js';
import { analyzeClosure } from '../src/ux-evaluation/closure-analyzer.js';
import { buildExplorationContext } from '../src/ux-evaluation/exploratory-context.js';
import { buildExploratoryScenarios } from '../src/ux-evaluation/exploratory-scenario-builder.js';
import { detectFrictions } from '../src/ux-evaluation/friction-detector.js';
import { calculateInteractionMetrics, fingerprintInput } from '../src/ux-evaluation/interaction-recorder.js';
import { compareJourneys } from '../src/ux-evaluation/journey-comparison.js';
import { buildFeatureJourneyGraph } from '../src/ux-evaluation/journey-graph-builder.js';
import { gradeUx } from '../src/ux-evaluation/ux-report-builder.js';

const capability: BlueprintCapability = {
  id: 'cap-recommend',
  name: '首次推荐',
  importance: 'critical',
  userGoals: ['获得推荐并理解推荐理由'],
  entryPoints: ['/'],
  successConditions: ['推荐结果可见', '推荐理由可理解', '可以保存或修改'],
  hardConstraints: ['公开保存前必须确认'],
  failureConditions: ['找不到入口', '结果没有下一步'],
  dependencies: [],
  requiredPersonas: ['persona-new-user'],
  requiredInputQualities: ['完整', '模糊'],
  requiredSystemStates: ['正常'],
  graders: ['page_reached'],
  approvalStatus: 'needs_human_review',
};

const blueprint: EvalBlueprint = {
  projectName: 'Fixture',
  inScope: ['web'],
  outOfScope: ['native'],
  capabilities: [capability],
  scenarioDimensions: { userType: ['新用户'] },
  scoring: { hardAssertions: ['safe'], rubricItems: ['quality'] },
  coverageTargets: { critical: 1 },
  releaseGates: ['P0=0'],
  approvalStatus: 'needs_human_review',
  generatedAt: new Date().toISOString(),
};

function completion(fullLoop: boolean): CompletionDefinition {
  return {
    technical: { conditions: ['接口完成'], complete: true, evidence: ['result.json'] },
    interface: { conditions: ['结果可见'], complete: true, evidence: ['result.png'] },
    userGoal: { conditions: ['用户获得结果'], complete: true, evidence: ['action-4'] },
    followUp: { conditions: ['可以保存或修改'], complete: fullLoop, evidence: fullLoop ? ['action-5'] : [] },
  };
}

function actions(): InteractionAction[] {
  const fingerprint = fingerprintInput('freshwater');
  return [
    { actionId: 'a1', type: 'navigation', timestampMs: 0, page: '/', target: '/', inputField: null, inputLength: null, inputFingerprint: null, outcome: 'started', evidence: ['trace'] },
    { actionId: 'a2', type: 'click', timestampMs: 500, page: '/', target: '开始推荐', inputField: null, inputLength: null, inputFingerprint: null, outcome: 'navigated', evidence: ['shot-1'] },
    { actionId: 'a3', type: 'input', timestampMs: 900, page: '/recommend', target: '项目名称', inputField: 'projectName', inputLength: 10, inputFingerprint: fingerprint, outcome: 'filled', evidence: ['trace'] },
    { actionId: 'a4', type: 'input', timestampMs: 1_100, page: '/recommend', target: '项目名称', inputField: 'projectName', inputLength: 10, inputFingerprint: fingerprint, outcome: 'filled_again', evidence: ['trace'] },
    { actionId: 'a5', type: 'backtrack', timestampMs: 1_400, page: '/', target: '返回', inputField: null, inputLength: null, inputFingerprint: null, outcome: 'back', evidence: ['trace'] },
    { actionId: 'a6', type: 'hesitation', timestampMs: 3_600, page: '/', target: null, inputField: null, inputLength: null, inputFingerprint: null, outcome: 'no_clear_next_action', evidence: ['shot-2'] },
  ];
}

describe('UX evaluation contracts', () => {
  it('builds a journey with four completion layers and protects safety steps', () => {
    const graph = buildFeatureJourneyGraph(capability);
    expect(graph.entryPoints).toEqual(['/']);
    expect(graph.steps.some((step) => step.type === 'safety')).toBe(true);
    expect(graph.completionDefinition.followUp.conditions).toContain('可以保存或修改');
    expect(graph.approvalStatus).toBe('needs_human_review');
  });

  it('creates eight behavioral personas including ambiguous and malicious users', () => {
    const personas = buildPersonas();
    expect(personas).toHaveLength(8);
    expect(personas.map((persona) => persona.personaId)).toEqual(expect.arrayContaining([
      'persona-ambiguous-goal',
      'persona-malicious',
    ]));
  });

  it('keeps exploratory scenarios isolated from paths, steps, and selectors', () => {
    const persona = buildPersonas()[0] as Persona;
    const scenario = buildExploratoryScenarios(blueprint, [persona])[0];
    expect(scenario).toBeDefined();
    expect(scenario?.successConditions).toEqual(capability.successConditions);
    const context = buildExplorationContext(scenario!, persona);
    expect(Object.keys(context).sort()).toEqual([
      'abandonmentPolicy', 'allowedActions', 'forbiddenActions', 'goal', 'knownInformation',
      'persona', 'startingUrl', 'successConditions',
    ].sort());
    expect(JSON.stringify(context)).not.toContain('primaryPath');
    expect(JSON.stringify(context)).not.toContain('selector');
    expect(() => exploratoryScenarioSchema.parse({ ...scenario, steps: [{ action: 'click', target: '#secret' }] })).toThrow();
  });

  it('records privacy-safe metrics and detects repeated input and friction', () => {
    const recorded = actions();
    const metrics = calculateInteractionMetrics(recorded, {
      completion: completion(false),
      requiredActionIds: ['a1', 'a2', 'a3'],
      redundantActionIds: ['a4'],
      abandoned: false,
      abandonmentReason: null,
    });
    expect(metrics.totalActions).toBe(6);
    expect(metrics.repeatedInputCount).toBe(1);
    expect(metrics.backtrackCount).toBe(1);
    expect(metrics.fullLoopCompleted).toBe(false);
    expect(recorded[2]?.inputFingerprint).not.toContain('freshwater');

    const frictions = detectFrictions({
      featureId: capability.id,
      personaId: 'persona-new-user',
      actions: recorded,
      metrics,
      completion: completion(false),
    });
    expect(frictions.map((event) => event.type)).toEqual(expect.arrayContaining([
      'repeated_input_issue',
      'path_efficiency_issue',
      'journey_breakpoint',
    ]));
    expect(frictions.every((event) => event.possibleUserReason.startsWith('推测：'))).toBe(true);
  });

  it('keeps an earlier no-feedback click as non-blocking UX friction even when the task later succeeds', () => {
    const recorded: InteractionAction[] = [
      { actionId: 'a1', type: 'navigation', timestampMs: 0, page: '/', target: '/', inputField: null, inputLength: null, inputFingerprint: null, outcome: 'started', evidence: ['start.png'] },
      { actionId: 'a2', type: 'click', timestampMs: 100, page: '/', target: '当前标签', inputField: null, inputLength: null, inputFingerprint: null, outcome: 'no_feedback', evidence: ['same.png'] },
      { actionId: 'a3', type: 'click', timestampMs: 200, page: '/', target: '进入详情', inputField: null, inputLength: null, inputFingerprint: null, outcome: 'observable_feedback', evidence: ['detail.png'] },
    ];
    const completed = completion(true);
    const metrics = calculateInteractionMetrics(recorded, {
      completion: completed,
      requiredActionIds: ['a1', 'a3'],
      redundantActionIds: ['a2'],
      abandoned: false,
      abandonmentReason: null,
    });
    const frictions = detectFrictions({
      featureId: capability.id,
      personaId: 'persona-new-user',
      actions: recorded,
      metrics,
      completion: completed,
    });
    const feedback = frictions.find((event) => event.type === 'interaction_feedback_issue');
    expect(feedback).toBeDefined();
    expect(feedback?.severity).toBe('P3');
    expect(feedback?.observedBehavior).toContain('任务最终完成');
  });

  it('compares ideal, actual, and shortest reasonable paths without deleting safety', () => {
    const graph = buildFeatureJourneyGraph(capability);
    const metrics = calculateInteractionMetrics(actions(), {
      completion: completion(false),
      requiredActionIds: ['a1', 'a2', 'a3'],
      redundantActionIds: ['a4'],
      abandoned: false,
      abandonmentReason: null,
    });
    const comparison = compareJourneys(graph, actions(), metrics, 'run-1');
    const protectedSteps = graph.steps.filter((step) => step.type === 'safety');
    expect(protectedSteps.length).toBeGreaterThan(0);
    expect(comparison.shortestReasonableActionCount).toBeGreaterThanOrEqual(protectedSteps.length);
    expect(comparison.actualActionCount).toBe(6);
    expect(comparison.extraActionCount).toBeGreaterThan(0);
  });

  it('stops at persona abandonment limits instead of retrying forever', () => {
    const state = analyzeAbandonment({
      actions: [...actions(), { actionId: 'a7', type: 'error', timestampMs: 4_000, page: '/', target: null, inputField: null, inputLength: null, inputFingerprint: null, outcome: 'same_error', evidence: [] }],
      failedAttempts: 2,
      clarificationTurns: 0,
      idleTimeMs: 0,
      policy: { maxFailedAttempts: 2, maxClarificationTurns: 3, maxIdleTimeMs: 10_000, maxTotalActions: 15, abandonOn: ['连续两次相同错误'] },
    });
    expect(state.abandoned).toBe(true);
    expect(state.reason).toContain('失败尝试');
  });

  it('separates functional status, UX score, and full-loop verdict', () => {
    const closure = analyzeClosure({
      technical: { conditions: ['接口成功'], evidence: ['result.json'], satisfied: true },
      interface: { conditions: ['结果显示'], evidence: ['shot.png'], satisfied: true },
      userGoal: { conditions: ['用户获得推荐'], evidence: ['action-4'], satisfied: true },
      followUp: { conditions: ['可以保存或修改'], evidence: [], satisfied: false },
    });
    expect(closure.fullLoopComplete).toBe(false);

    const metrics = calculateInteractionMetrics(actions(), {
      completion: closure.completion,
      requiredActionIds: ['a1', 'a2', 'a3'],
      redundantActionIds: ['a4'],
      abandoned: false,
      abandonmentReason: null,
    });
    const evaluation = gradeUx({
      runId: 'run-1',
      functionalStatus: 'passed',
      completion: closure.completion,
      metrics,
      frictions: detectFrictions({ featureId: capability.id, personaId: 'persona-new-user', actions: actions(), metrics, completion: closure.completion }),
      directEvidence: ['trace.zip'],
    });
    expect(evaluation.functionalStatus).toBe('passed');
    expect(evaluation.uxScores).toHaveLength(12);
    expect(evaluation.verdict).toBe('full_loop_failed');
    expect(evaluation.authenticityNotice.join(' ')).toContain('模拟用户');
  });
});
