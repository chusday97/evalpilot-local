import { describe, expect, it } from 'vitest';
import { builtinBenchmarkFixtures } from '../src/benchmark/fixtures.js';
import { calculateBenchmarkMetrics } from '../src/benchmark/metrics.js';
import { runBuiltinBenchmark } from '../src/benchmark/runner.js';

describe('EvalPilot self benchmark', () => {
  it('contains the required 20 known failures and 20 clean behaviors', () => {
    const fixtures = builtinBenchmarkFixtures();
    expect(fixtures).toHaveLength(40);
    expect(fixtures.filter((item) => item.groundTruth.expectedIssues.length > 0)).toHaveLength(20);
    expect(fixtures.filter((item) => item.groundTruth.expectedIssues.length === 0)).toHaveLength(20);
    expect(new Set(fixtures.map((item) => item.groundTruth.fixtureId)).size).toBe(40);
  });

  it('reports all five metrics and keeps the fixture-only limitation visible', () => {
    const report = runBuiltinBenchmark('2026-08-01T16:00:00.000Z');
    expect(report.metrics).toMatchObject({ total: 40, knownFailures: 20, cleanBehaviors: 20, bugDetectionRecall: 1, precision: 1, falsePositiveRate: 0, classificationAccuracy: 1, evaluatorFailureRate: 0 });
    expect(report.predictions).toHaveLength(40);
    expect(report.limitation).toMatch(/不证明/);
  });

  it('counts evaluator failures separately instead of turning them into product issues', () => {
    const fixtures = builtinBenchmarkFixtures().slice(0, 2);
    const metrics = calculateBenchmarkMetrics(fixtures, fixtures.map((item) => ({ fixtureId: item.groundTruth.fixtureId, issues: [], evaluatorFailure: true })));
    expect(metrics).toMatchObject({ evaluatorFailureRate: 1, falseNegatives: 2, falsePositives: 0 });
  });
});
