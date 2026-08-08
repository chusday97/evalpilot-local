import type { CoverageCell, CoverageDimension, CoverageDimensionSummary, CoverageGap, CoverageMatrix, EvalCase, EvalCaseResult, EvidencePacket, ProductModel } from '../../types.js';
import { evidencePacketComplete } from '../judge/verdict-merger.js';
import { coverageMatrixSchema } from './schemas.js';

const fixedTargets: Partial<Record<CoverageDimension, string[]>> = {
  input_quality: ['complete', 'empty', 'boundary'],
  system_state: ['normal', 'error'],
  journey_stage: ['core_task', 'backtrack', 'reopen'],
  recovery: ['retry', 'back'],
  interaction_pattern: ['normal', 'duplicate_submit', 'refresh'],
};

export interface CoverageAnalysisInput {
  model: ProductModel;
  cases: EvalCase[];
  results?: EvalCaseResult[];
  evidencePackets?: EvidencePacket[];
  generatedAt?: string;
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'unknown';
}

function latestByCase(results: EvalCaseResult[]): Map<string, EvalCaseResult> {
  const latest = new Map<string, EvalCaseResult>();
  for (const result of results) {
    const current = latest.get(result.caseId);
    if (!current || result.createdAt > current.createdAt) latest.set(result.caseId, result);
  }
  return latest;
}

function gapReason(cell: CoverageCell): string {
  const label = `${cell.dimension}「${cell.value}」`;
  if (cell.assetStatus === 'missing') return `功能 ${cell.capabilityId} 缺少 ${label} 的评测案例。`;
  if (cell.executionStatus === 'not_run') return `功能 ${cell.capabilityId} 已定义 ${label} 案例，但尚未执行。`;
  if (cell.executionStatus === 'fail') return `功能 ${cell.capabilityId} 的 ${label} 已发现产品失败，尚未完成修复和回归。`;
  if (cell.executionStatus === 'inconclusive') return `功能 ${cell.capabilityId} 的 ${label} 已经执行，但结果无法判断。`;
  return `功能 ${cell.capabilityId} 的 ${label} 已执行，但稳定案例或完整证据尚不足，不能算作已验证。`;
}

export function analyzeCoverage(input: CoverageAnalysisInput): CoverageMatrix {
  const { model } = input;
  const cases = input.cases.filter((item) => item.status !== 'retired');
  const resultByCase = latestByCase(input.results ?? []);
  const packetByRun = new Map((input.evidencePackets ?? []).map((packet) => [packet.runId, packet]));
  const cells: CoverageCell[] = [];

  for (const capability of model.capabilities) {
    const targets = new Map<CoverageDimension, string[]>([
      ['capability', [capability.capabilityId]],
      ['persona', model.targetUsers.map((item) => item.userTypeId)],
      ['risk', [capability.importance]],
      ...Object.entries(fixedTargets) as Array<[CoverageDimension, string[]]>,
    ]);
    for (const [dimension, values] of targets) {
      for (const value of values) {
        const matchingCases = cases.filter((evalCase) => evalCase.capabilityId === capability.capabilityId && evalCase.coverageDimensions.some((entry) => entry.dimension === dimension && entry.value === value));
        const caseResults = matchingCases.map((evalCase) => resultByCase.get(evalCase.caseId)).filter((result): result is EvalCaseResult => Boolean(result));
        const latestResult = caseResults.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
        const stableCases = matchingCases.filter((evalCase) => evalCase.status === 'stable');
        const verified = stableCases.some((evalCase) => {
          const result = resultByCase.get(evalCase.caseId);
          const packet = result ? packetByRun.get(result.runId) : null;
          return result?.verdict === 'pass' && result.failureSource === null && Boolean(packet && evidencePacketComplete(packet));
        });
        cells.push({
          cellId: `cell-${safeId(capability.capabilityId)}-${safeId(dimension)}-${safeId(value)}`,
          capabilityId: capability.capabilityId,
          dimension,
          value,
          assetStatus: matchingCases.some((evalCase) => evalCase.status === 'stable') ? 'stable' : matchingCases.length ? 'candidate' : 'missing',
          executionStatus: latestResult?.verdict ?? 'not_run',
          caseIds: matchingCases.map((evalCase) => evalCase.caseId),
          latestRunId: latestResult?.runId ?? null,
          latestResultAt: latestResult?.createdAt ?? null,
          verified,
        });
      }
    }
  }

  const dimensionKinds = [...new Set(cells.map((cell) => cell.dimension))];
  const dimensions: CoverageDimensionSummary[] = dimensionKinds.map((dimension) => {
    const dimensionCells = cells.filter((cell) => cell.dimension === dimension);
    const targetValues = [...new Set(dimensionCells.map((cell) => cell.value))];
    const coveredValues = targetValues.filter((value) => dimensionCells.filter((cell) => cell.value === value).every((cell) => cell.verified));
    const missingValues = targetValues.filter((value) => !coveredValues.includes(value));
    return { dimension, targetValues, coveredValues, missingValues, coverageRatio: dimensionCells.length ? dimensionCells.filter((cell) => cell.verified).length / dimensionCells.length : 1 };
  });
  const gaps: CoverageGap[] = cells.filter((cell) => !cell.verified).map((cell) => ({
    gapId: `gap-${safeId(cell.capabilityId)}-${safeId(cell.dimension)}-${safeId(cell.value)}`,
    kind: cell.assetStatus === 'missing' ? 'missing_asset' : cell.executionStatus === 'not_run' ? 'not_executed' : cell.executionStatus === 'fail' ? 'failed' : cell.executionStatus === 'inconclusive' ? 'inconclusive' : 'not_verified',
    capabilityId: cell.capabilityId,
    dimension: cell.dimension,
    missingValue: cell.value,
    priority: dimensionPriority(cell.dimension),
    reason: gapReason(cell),
    candidateCaseIds: cell.caseIds.filter((caseId) => cases.find((evalCase) => evalCase.caseId === caseId)?.status === 'candidate'),
  }));
  const totalTargetCells = cells.length;
  const assetCoveredCells = cells.filter((cell) => cell.assetStatus !== 'missing').length;
  const executedCells = cells.filter((cell) => cell.executionStatus !== 'not_run').length;
  const verifiedCells = cells.filter((cell) => cell.verified).length;
  const ratio = (count: number) => totalTargetCells ? count / totalTargetCells : 1;
  return coverageMatrixSchema.parse({
    projectId: model.projectId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    dimensions,
    gaps,
    totalTargetCells,
    assetCoveredCells,
    executedCells,
    verifiedCells,
    coveredCells: verifiedCells,
    assetCoverageRatio: ratio(assetCoveredCells),
    executionCoverageRatio: ratio(executedCells),
    verifiedCoverageRatio: ratio(verifiedCells),
    cells,
    coverageRatio: ratio(verifiedCells),
  });
}

function dimensionPriority(dimension: CoverageDimension): 'critical' | 'high' | 'medium' {
  if (dimension === 'capability' || dimension === 'risk') return 'critical';
  if (dimension === 'persona' || dimension === 'journey_stage') return 'high';
  return 'medium';
}
