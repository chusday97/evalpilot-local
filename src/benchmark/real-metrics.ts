import type { RealBenchmarkFixtureResult, RealBenchmarkMetrics, RealBenchmarkRunResult } from '../../types.js';
import { realBenchmarkMetricsSchema } from '../eval-set/schemas.js';

const ratio = (numerator: number, denominator: number): number => denominator === 0 ? 0 : numerator / denominator;

function detected(run: RealBenchmarkRunResult): boolean { return run.predictedIssues.length > 0; }

export function calculateRealBenchmarkMetrics(results: RealBenchmarkFixtureResult[]): RealBenchmarkMetrics {
  const runs = results.flatMap((result) => result.runs.map((run) => ({ run, truth: result.groundTruth })));
  const failing = runs.filter(({ truth }) => truth.expectedIssues.length > 0);
  const clean = runs.filter(({ truth }) => truth.expectedIssues.length === 0);
  const detectedFailures = failing.filter(({ run }) => detected(run));
  const falsePositiveRuns = clean.filter(({ run }) => detected(run));
  const predictedPositiveRuns = runs.filter(({ run }) => detected(run));
  const categoryMatches = detectedFailures.filter(({ run, truth }) => truth.expectedIssues.some((expected) => run.predictedIssues.some((predicted) => predicted.category === expected.category))).length;
  const severityMatches = detectedFailures.filter(({ run, truth }) => truth.expectedIssues.some((expected) => run.predictedIssues.some((predicted) => predicted.severity === expected.severity))).length;
  const sourceMatches = runs.filter(({ run, truth }) => run.failureSource === truth.expectedFailureSource).length;
  return realBenchmarkMetricsSchema.parse({
    fixtures: results.length,
    runs: runs.length,
    taskCompletionRate: ratio(runs.filter(({ run }) => run.taskCompleted).length, runs.length),
    bugDetectionRecall: ratio(detectedFailures.length, failing.length),
    precision: ratio(detectedFailures.length, predictedPositiveRuns.length),
    falsePositiveRate: ratio(falsePositiveRuns.length, clean.length),
    categoryAccuracy: ratio(categoryMatches, detectedFailures.length),
    severityAccuracy: ratio(severityMatches, detectedFailures.length),
    failureSourceAccuracy: ratio(sourceMatches, runs.length),
    inconclusiveRate: ratio(runs.filter(({ run }) => run.inconclusive).length, runs.length),
    runToRunConsistency: ratio(results.filter((result) => result.consistent).length, results.length),
  });
}
