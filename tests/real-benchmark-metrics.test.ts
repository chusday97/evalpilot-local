import { describe, expect, it } from 'vitest';
import type { BadcaseCategory, RealBenchmarkFixtureResult, RealBenchmarkRunResult, Severity } from '../types.js';
import { calculateRealBenchmarkMetrics } from '../src/benchmark/real-metrics.js';

function run(
  fixtureId: string,
  repetition: number,
  issue: { category: BadcaseCategory; severity: Severity } | null,
  taskCompleted: boolean,
): RealBenchmarkRunResult {
  return {
    fixtureId,
    repetition,
    runId: `${fixtureId}-${repetition}`,
    agentStatus: 'completed',
    verdict: issue ? 'fail' : 'pass',
    failureSource: issue ? 'product' : null,
    predictedIssues: issue ? [{ issueId: `${fixtureId}-issue`, ...issue, summary: 'Observed failure' }] : [],
    taskCompleted,
    inconclusive: false,
  };
}

describe('Phase 7 real benchmark metrics', () => {
  it('separates product detection accuracy from clean task completion', () => {
    const results: RealBenchmarkFixtureResult[] = [
      {
        groundTruth: {
          fixtureId: 'dead-click',
          expectedIssues: [{ category: 'interaction', severity: 'P1' }],
          expectedFailureSource: 'product',
          forbiddenCategories: [],
        },
        runs: [1, 2, 3].map((repetition) => run('dead-click', repetition, { category: 'interaction', severity: 'P1' }, false)),
        consistent: true,
      },
      {
        groundTruth: {
          fixtureId: 'clean-form',
          expectedIssues: [],
          expectedFailureSource: null,
          forbiddenCategories: [],
        },
        runs: [1, 2, 3].map((repetition) => run('clean-form', repetition, null, true)),
        consistent: true,
      },
    ];

    expect(calculateRealBenchmarkMetrics(results)).toEqual({
      fixtures: 2,
      runs: 6,
      taskCompletionRate: 0.5,
      bugDetectionRecall: 1,
      precision: 1,
      falsePositiveRate: 0,
      categoryAccuracy: 1,
      severityAccuracy: 1,
      failureSourceAccuracy: 1,
      inconclusiveRate: 0,
      runToRunConsistency: 1,
    });
  });

  it('counts missed failures, clean false positives, and inconsistent repeats separately', () => {
    const failing: RealBenchmarkFixtureResult = {
      groundTruth: {
        fixtureId: 'dead-click',
        expectedIssues: [{ category: 'interaction', severity: 'P1' }],
        expectedFailureSource: 'product',
        forbiddenCategories: [],
      },
      runs: [
        run('dead-click', 1, { category: 'interaction', severity: 'P1' }, false),
        { ...run('dead-click', 2, null, false), verdict: 'inconclusive', failureSource: 'unknown', inconclusive: true },
        { ...run('dead-click', 3, null, false), verdict: 'inconclusive', failureSource: 'unknown', inconclusive: true },
      ],
      consistent: false,
    };
    const clean: RealBenchmarkFixtureResult = {
      groundTruth: {
        fixtureId: 'clean-form',
        expectedIssues: [],
        expectedFailureSource: null,
        forbiddenCategories: [],
      },
      runs: [
        run('clean-form', 1, null, true),
        run('clean-form', 2, null, true),
        run('clean-form', 3, { category: 'interaction', severity: 'P2' }, false),
      ],
      consistent: false,
    };

    expect(calculateRealBenchmarkMetrics([failing, clean])).toMatchObject({
      bugDetectionRecall: 1 / 3,
      precision: 1 / 2,
      falsePositiveRate: 1 / 3,
      failureSourceAccuracy: 1 / 2,
      inconclusiveRate: 1 / 3,
      runToRunConsistency: 0,
    });
  });
});
