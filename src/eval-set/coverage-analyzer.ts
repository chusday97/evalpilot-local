import type { CoverageDimension, CoverageDimensionSummary, CoverageGap, CoverageMatrix, EvalCase, ProductModel } from '../../types.js';
import { coverageMatrixSchema } from './schemas.js';

const fixedTargets: Partial<Record<CoverageDimension, string[]>> = {
  input_quality: ['complete', 'empty', 'boundary'],
  system_state: ['normal', 'error'],
  journey_stage: ['core_task', 'backtrack', 'reopen'],
  recovery: ['retry', 'back'],
  interaction_pattern: ['normal', 'duplicate_submit', 'refresh'],
};

export function analyzeCoverage(model: ProductModel, cases: EvalCase[], generatedAt = new Date().toISOString()): CoverageMatrix {
  const targets = new Map<CoverageDimension, string[]>([
    ['capability', model.capabilities.map((item) => item.capabilityId)],
    ['persona', model.targetUsers.map((item) => item.userTypeId)],
    ['risk', [...new Set(model.capabilities.map((item) => item.importance))]],
    ...Object.entries(fixedTargets) as Array<[CoverageDimension, string[]]>,
  ]);
  const coveredByDimension = new Map<CoverageDimension, Set<string>>();
  for (const evalCase of cases.filter((item) => item.status !== 'retired')) {
    for (const value of evalCase.coverageDimensions) {
      const values = coveredByDimension.get(value.dimension) ?? new Set<string>();
      values.add(value.value); coveredByDimension.set(value.dimension, values);
    }
  }
  const dimensions: CoverageDimensionSummary[] = [...targets.entries()].map(([dimension, targetValues]) => {
    const covered = coveredByDimension.get(dimension) ?? new Set<string>();
    const coveredValues = targetValues.filter((value) => covered.has(value));
    const missingValues = targetValues.filter((value) => !covered.has(value));
    return { dimension, targetValues, coveredValues, missingValues, coverageRatio: targetValues.length ? coveredValues.length / targetValues.length : 1 };
  });
  const primaryCapability = model.capabilities.find((item) => item.importance === 'critical')?.capabilityId ?? model.capabilities[0]?.capabilityId ?? 'cap-unknown';
  const gaps: CoverageGap[] = dimensions.flatMap((summary) => summary.missingValues.map((missingValue) => ({
    gapId: `gap-${summary.dimension}-${missingValue.replace(/[^a-zA-Z0-9._-]+/g, '-').toLowerCase()}`,
    capabilityId: summary.dimension === 'capability' ? missingValue : primaryCapability,
    dimension: summary.dimension,
    missingValue,
    priority: summary.dimension === 'capability' || summary.dimension === 'risk' ? 'critical' : summary.dimension === 'persona' || summary.dimension === 'journey_stage' ? 'high' : 'medium',
    reason: `${summary.dimension} 尚未覆盖 ${missingValue}。`,
    candidateCaseIds: [],
  })));
  const totalTargetCells = dimensions.reduce((sum, item) => sum + item.targetValues.length, 0);
  const coveredCells = dimensions.reduce((sum, item) => sum + item.coveredValues.length, 0);
  return coverageMatrixSchema.parse({ projectId: model.projectId, generatedAt, dimensions, gaps, totalTargetCells, coveredCells, coverageRatio: totalTargetCells ? coveredCells / totalTargetCells : 1 });
}
