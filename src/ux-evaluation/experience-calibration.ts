import type { UxIssueType } from '../../types.js';
import { detectFrictions, type FrictionInput } from './friction-detector.js';

export const CALIBRATED_EXPERIENCE_DETECTOR_TYPES = [
  'repeated_input_issue',
  'interaction_feedback_issue',
  'path_efficiency_issue',
  'journey_breakpoint',
  'abandonment_risk',
] as const satisfies readonly UxIssueType[];

export type CalibratedExperienceDetectorType = typeof CALIBRATED_EXPERIENCE_DETECTOR_TYPES[number];

export interface ExperienceCalibrationFixture {
  fixtureId: string;
  description: string;
  input: FrictionInput;
  expectedTypes: CalibratedExperienceDetectorType[];
}

export interface ExperienceCalibrationPrediction {
  fixtureId: string;
  expectedTypes: CalibratedExperienceDetectorType[];
  predictedTypes: CalibratedExperienceDetectorType[];
  unexpectedTypes: CalibratedExperienceDetectorType[];
  missingTypes: CalibratedExperienceDetectorType[];
  exactMatch: boolean;
}

export interface ExperienceCalibrationTypeMetrics {
  type: CalibratedExperienceDetectorType;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  trueNegative: number;
  precision: number;
  recall: number;
  falsePositiveRate: number;
}

export interface ExperienceCalibrationMetrics {
  fixtures: number;
  cleanFixtures: number;
  positiveFixtures: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  exactMatchAccuracy: number;
  cleanFixtureFalsePositiveRate: number;
}

export interface ExperienceCalibrationReport {
  benchmarkVersion: 'experience-detector-v1';
  generatedAt: string;
  detectorTypes: readonly CalibratedExperienceDetectorType[];
  metrics: ExperienceCalibrationMetrics;
  byType: ExperienceCalibrationTypeMetrics[];
  predictions: ExperienceCalibrationPrediction[];
  limitation: string;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function uniqueCalibratedTypes(types: UxIssueType[]): CalibratedExperienceDetectorType[] {
  const allowed = new Set<CalibratedExperienceDetectorType>(CALIBRATED_EXPERIENCE_DETECTOR_TYPES);
  return [...new Set(types.filter((type): type is CalibratedExperienceDetectorType => allowed.has(type as CalibratedExperienceDetectorType)))];
}

export function calibrateExperienceDetector(
  fixtures: ExperienceCalibrationFixture[],
  generatedAt = new Date().toISOString(),
): ExperienceCalibrationReport {
  const predictions = fixtures.map((fixture): ExperienceCalibrationPrediction => {
    const expectedTypes = uniqueCalibratedTypes(fixture.expectedTypes);
    const predictedTypes = uniqueCalibratedTypes(detectFrictions(fixture.input).map((item) => item.type));
    const expected = new Set(expectedTypes);
    const predicted = new Set(predictedTypes);
    const unexpectedTypes = predictedTypes.filter((type) => !expected.has(type));
    const missingTypes = expectedTypes.filter((type) => !predicted.has(type));
    return {
      fixtureId: fixture.fixtureId,
      expectedTypes,
      predictedTypes,
      unexpectedTypes,
      missingTypes,
      exactMatch: unexpectedTypes.length === 0 && missingTypes.length === 0,
    };
  });

  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  for (const prediction of predictions) {
    const expected = new Set(prediction.expectedTypes);
    truePositives += prediction.predictedTypes.filter((type) => expected.has(type)).length;
    falsePositives += prediction.unexpectedTypes.length;
    falseNegatives += prediction.missingTypes.length;
  }

  const cleanPredictions = predictions.filter((item) => item.expectedTypes.length === 0);
  const byType = CALIBRATED_EXPERIENCE_DETECTOR_TYPES.map((type): ExperienceCalibrationTypeMetrics => {
    let truePositive = 0;
    let falsePositive = 0;
    let falseNegative = 0;
    let trueNegative = 0;
    for (const prediction of predictions) {
      const expected = prediction.expectedTypes.includes(type);
      const predicted = prediction.predictedTypes.includes(type);
      if (expected && predicted) truePositive += 1;
      else if (!expected && predicted) falsePositive += 1;
      else if (expected && !predicted) falseNegative += 1;
      else trueNegative += 1;
    }
    return {
      type,
      truePositive,
      falsePositive,
      falseNegative,
      trueNegative,
      precision: ratio(truePositive, truePositive + falsePositive),
      recall: ratio(truePositive, truePositive + falseNegative),
      falsePositiveRate: ratio(falsePositive, falsePositive + trueNegative),
    };
  });

  return {
    benchmarkVersion: 'experience-detector-v1',
    generatedAt,
    detectorTypes: CALIBRATED_EXPERIENCE_DETECTOR_TYPES,
    metrics: {
      fixtures: fixtures.length,
      cleanFixtures: cleanPredictions.length,
      positiveFixtures: fixtures.length - cleanPredictions.length,
      truePositives,
      falsePositives,
      falseNegatives,
      precision: ratio(truePositives, truePositives + falsePositives),
      recall: ratio(truePositives, truePositives + falseNegatives),
      exactMatchAccuracy: ratio(predictions.filter((item) => item.exactMatch).length, predictions.length),
      cleanFixtureFalsePositiveRate: ratio(cleanPredictions.filter((item) => item.predictedTypes.length > 0).length, cleanPredictions.length),
    },
    byType,
    predictions,
    limitation: '这是针对当前规则型 Experience detector 的受控 ground-truth 校准，不代表真实用户满意度，也不测尚未实现的 UX 维度。',
  };
}
