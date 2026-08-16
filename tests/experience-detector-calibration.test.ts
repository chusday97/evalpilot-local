import { describe, expect, it } from 'vitest';
import type { CompletionDefinition, InteractionAction, SimulatedUserMetrics } from '../types.js';
import {
  calibrateExperienceDetector,
  type ExperienceCalibrationFixture,
} from '../src/ux-evaluation/experience-calibration.js';

function action(
  actionId: string,
  type: InteractionAction['type'],
  overrides: Partial<InteractionAction> = {},
): InteractionAction {
  return {
    actionId,
    type,
    timestampMs: 100,
    page: '/fixture',
    target: null,
    inputField: null,
    inputLength: null,
    inputFingerprint: null,
    outcome: 'progress',
    evidence: [`${actionId}.png`],
    ...overrides,
  };
}

function metrics(overrides: Partial<SimulatedUserMetrics> = {}): SimulatedUserMetrics {
  return {
    metricType: 'simulated_user_run',
    timeToFirstActionMs: 100,
    timeToFindEntryMs: 100,
    timeToFirstMeaningfulActionMs: 100,
    timeToCompleteMs: 500,
    totalActions: 1,
    requiredActions: 0,
    redundantActions: 0,
    clickCount: 0,
    inputCount: 0,
    pageTransitions: 0,
    backtrackCount: 0,
    retryCount: 0,
    repeatedInputCount: 0,
    deadClickCount: 0,
    clarificationCount: 0,
    deadEndCount: 0,
    errorCount: 0,
    recoveryAttempts: 0,
    recoverySuccess: false,
    taskCompleted: true,
    fullLoopCompleted: true,
    abandoned: false,
    abandonmentReason: null,
    finalConfidence: 'high',
    ...overrides,
  };
}

function completion(userGoal: boolean | null, followUp: boolean | null = null): CompletionDefinition {
  return {
    technical: { conditions: [], complete: userGoal, evidence: [] },
    interface: { conditions: [], complete: userGoal, evidence: [] },
    userGoal: { conditions: [], complete: userGoal, evidence: [] },
    followUp: { conditions: [], complete: followUp, evidence: [] },
  };
}

function fixture(
  fixtureId: string,
  actions: InteractionAction[],
  expectedTypes: ExperienceCalibrationFixture['expectedTypes'],
  options: {
    metrics?: Partial<SimulatedUserMetrics>;
    userGoal?: boolean | null;
    followUp?: boolean | null;
    description?: string;
  } = {},
): ExperienceCalibrationFixture {
  return {
    fixtureId,
    description: options.description ?? fixtureId,
    expectedTypes,
    input: {
      featureId: 'cap-calibration',
      personaId: 'persona-calibration',
      actions,
      metrics: metrics({ totalActions: actions.length, ...options.metrics }),
      completion: completion(options.userGoal ?? true, options.followUp ?? null),
    },
  };
}

const fixtures: ExperienceCalibrationFixture[] = [
  fixture('clean-success', [action('clean-click', 'click')], []),
  fixture(
    'repeat-same-field',
    [
      action('input-1', 'input', { inputField: 'email', inputLength: 8, inputFingerprint: 'fp-a' }),
      action('input-2', 'input', { inputField: 'email', inputLength: 8, inputFingerprint: 'fp-a' }),
    ],
    ['repeated_input_issue'],
  ),
  fixture(
    'same-value-different-fields-is-clean',
    [
      action('width', 'input', { inputField: 'width', inputLength: 2, inputFingerprint: '30' }),
      action('height', 'input', { inputField: 'height', inputLength: 2, inputFingerprint: '30' }),
    ],
    [],
  ),
  fixture(
    'click-no-feedback-but-eventual-success',
    [action('dead-click', 'click', { outcome: 'no_feedback' })],
    ['interaction_feedback_issue'],
  ),
  fixture(
    'explicit-hesitation',
    [action('hesitate', 'hesitation', { outcome: 'cannot_choose_next_action' })],
    ['path_efficiency_issue'],
  ),
  fixture(
    'route-backtrack',
    [action('back', 'backtrack')],
    ['path_efficiency_issue'],
    { metrics: { backtrackCount: 1 } },
  ),
  fixture(
    'dead-end',
    [action('dead-end', 'navigation', { outcome: 'dead_end' })],
    ['journey_breakpoint'],
    { userGoal: false, metrics: { taskCompleted: false, fullLoopCompleted: false } },
  ),
  fixture(
    'pre-completion-abandonment',
    [action('abandon', 'abandon')],
    ['abandonment_risk'],
    { userGoal: false, metrics: { taskCompleted: false, fullLoopCompleted: false, abandoned: true, abandonmentReason: 'no safe next action' } },
  ),
  fixture(
    'post-completion-abandon-is-clean',
    [action('terminal-abandon', 'abandon')],
    [],
    { userGoal: true, metrics: { abandoned: true, abandonmentReason: 'actor did not see hidden evaluator completion' } },
  ),
  fixture(
    'missing-follow-up-after-success',
    [action('finish-goal', 'click')],
    ['journey_breakpoint'],
    { userGoal: true, followUp: false },
  ),
  fixture(
    'retry-alone-is-not-friction',
    [action('retry', 'retry')],
    [],
    { userGoal: true, metrics: { retryCount: 1 } },
  ),
];

describe('experience detector calibration', () => {
  it('measures the current detector against explicit positive and clean ground truth', () => {
    const report = calibrateExperienceDetector(fixtures, '2026-08-16T00:00:00.000Z');

    expect(report.benchmarkVersion).toBe('experience-detector-v1');
    expect(report.metrics.fixtures).toBe(11);
    expect(report.metrics.cleanFixtures).toBe(4);
    expect(report.metrics.positiveFixtures).toBe(7);
    expect(report.metrics.precision).toBe(1);
    expect(report.metrics.recall).toBe(1);
    expect(report.metrics.exactMatchAccuracy).toBe(1);
    expect(report.metrics.cleanFixtureFalsePositiveRate).toBe(0);
    expect(report.predictions.every((item) => item.exactMatch)).toBe(true);
  });

  it('reports per-detector false positives and false negatives instead of hiding them in one score', () => {
    const report = calibrateExperienceDetector(fixtures, '2026-08-16T00:00:00.000Z');

    for (const metric of report.byType) {
      expect(metric.falsePositive, `${metric.type} false positives`).toBe(0);
      expect(metric.falseNegative, `${metric.type} false negatives`).toBe(0);
      expect(metric.precision, `${metric.type} precision`).toBe(1);
      expect(metric.recall, `${metric.type} recall`).toBe(1);
    }
  });

  it('exposes an injected false positive in the report', () => {
    const deliberatelyMislabeled = fixture(
      'known-clean-no-feedback',
      [action('unexpected-feedback-detector', 'click', { outcome: 'no_feedback' })],
      [],
    );
    const report = calibrateExperienceDetector([deliberatelyMislabeled], '2026-08-16T00:00:00.000Z');

    expect(report.metrics.falsePositives).toBe(1);
    expect(report.metrics.precision).toBe(0);
    expect(report.metrics.cleanFixtureFalsePositiveRate).toBe(1);
    expect(report.predictions[0]).toMatchObject({
      unexpectedTypes: ['interaction_feedback_issue'],
      exactMatch: false,
    });
  });
});
