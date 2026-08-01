import type { BenchmarkFixture, BenchmarkMetrics, BenchmarkPrediction } from '../../types.js';
import { benchmarkMetricsSchema } from '../eval-set/schemas.js';

const ratio = (value: number, denominator: number) => denominator === 0 ? 0 : value / denominator;

export function calculateBenchmarkMetrics(fixtures: BenchmarkFixture[], predictions: BenchmarkPrediction[]): BenchmarkMetrics {
  const predictionById = new Map(predictions.map((item) => [item.fixtureId, item]));
  let truePositives = 0; let falsePositives = 0; let falseNegatives = 0; let trueNegatives = 0; let classified = 0; let correctClassifications = 0; let evaluatorFailures = 0;
  for (const fixture of fixtures) {
    const prediction = predictionById.get(fixture.groundTruth.fixtureId);
    if (!prediction || prediction.evaluatorFailure) { evaluatorFailures += 1; if (fixture.groundTruth.expectedIssues.length) falseNegatives += 1; else trueNegatives += 1; continue; }
    const expectedFailure = fixture.groundTruth.expectedIssues.length > 0; const predictedFailure = prediction.issues.length > 0;
    if (expectedFailure && predictedFailure) { truePositives += 1; classified += 1; const expectedCategories = new Set(fixture.groundTruth.expectedIssues.map((item) => item.category)); if (prediction.issues.some((item) => expectedCategories.has(item.category))) correctClassifications += 1; }
    else if (expectedFailure) falseNegatives += 1;
    else if (predictedFailure) falsePositives += 1;
    else trueNegatives += 1;
  }
  const knownFailures = fixtures.filter((item) => item.groundTruth.expectedIssues.length > 0).length; const cleanBehaviors = fixtures.length - knownFailures;
  return benchmarkMetricsSchema.parse({ total: fixtures.length, knownFailures, cleanBehaviors, truePositives, falsePositives, falseNegatives, trueNegatives, bugDetectionRecall: ratio(truePositives, truePositives + falseNegatives), precision: ratio(truePositives, truePositives + falsePositives), falsePositiveRate: ratio(falsePositives, falsePositives + trueNegatives), classificationAccuracy: ratio(correctClassifications, classified), evaluatorFailureRate: ratio(evaluatorFailures, fixtures.length) });
}
