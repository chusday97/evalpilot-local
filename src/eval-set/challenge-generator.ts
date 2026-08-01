import type { CoverageGap, EvalCase, ProductModel } from '../../types.js';
import { evalCaseSchema } from './schemas.js';

function withDimension(source: EvalCase, dimension: EvalCase['coverageDimensions'][number]['dimension'], value: string) {
  return [...source.coverageDimensions.filter((item) => item.dimension !== dimension), { dimension, value }];
}

function candidate(source: EvalCase, gap: CoverageGap, suffix: string, changes: Partial<EvalCase>): EvalCase {
  const createdAt = changes.createdAt ?? new Date().toISOString();
  return evalCaseSchema.parse({
    ...source,
    ...changes,
    caseId: `case-challenge-${source.caseId.replace(/^case-/, '')}-${suffix}`,
    setType: 'challenge',
    status: 'candidate',
    origin: { type: 'generated_from_coverage_gap', sourceCaseIds: [source.caseId], gapId: gap.gapId },
    generationReason: `PASS 后针对 ${gap.dimension}:${gap.missingValue} 生成候选。`,
    version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 1, lastExecutedAt: null },
    regressionMetadata: null,
    retirementReason: null,
    createdAt,
    updatedAt: createdAt,
  });
}

function gapFor(gaps: CoverageGap[], dimension: CoverageGap['dimension'], fallback: string, capabilityId: string): CoverageGap {
  return gaps.find((item) => item.dimension === dimension) ?? { gapId: `gap-${dimension}-${fallback}`, capabilityId, dimension, missingValue: fallback, priority: 'high', reason: `${dimension} 需要新的覆盖。`, candidateCaseIds: [] };
}

export function generateChallengeCandidates(source: EvalCase, model: ProductModel, gaps: CoverageGap[], createdAt = new Date().toISOString()): EvalCase[] {
  const boundaryGap = gapFor(gaps, 'input_quality', 'boundary', source.capabilityId);
  const journeyGap = gapFor(gaps, 'journey_stage', 'backtrack', source.capabilityId);
  const alternativeUser = model.targetUsers.find((item) => item.userTypeId !== source.persona.personaId);
  const personaGap = gapFor(gaps, 'persona', alternativeUser?.userTypeId ?? 'low-patience-user', source.capabilityId);
  return [
    candidate(source, boundaryGap, 'boundary', {
      title: `${source.title}（边界输入）`,
      hypothesis: `${source.hypothesis}，在边界输入下仍应给出安全、可理解的结果。`,
      knownInformation: { ...source.knownInformation, boundaryInput: '' },
      coverageDimensions: withDimension(source, 'input_quality', boundaryGap.missingValue),
      createdAt,
    }),
    candidate(source, journeyGap, 'journey', {
      title: `${source.title}（返回后继续）`,
      hypothesis: `${source.hypothesis}，用户返回上一页后仍能恢复任务。`,
      preconditions: [...source.preconditions, '任务中途返回上一页后继续'],
      coverageDimensions: withDimension(source, 'journey_stage', journeyGap.missingValue),
      createdAt,
    }),
    candidate(source, personaGap, 'persona', {
      title: `${source.title}（${alternativeUser?.name ?? '低耐心用户'}）`,
      hypothesis: `${alternativeUser?.name ?? '低耐心用户'}也能发现入口并理解结果。`,
      persona: { personaId: alternativeUser?.userTypeId ?? 'user-low-patience', name: alternativeUser?.name ?? '低耐心用户', behaviorPolicy: ['一次失败后放弃', '不使用专业术语猜测入口'] },
      coverageDimensions: withDimension(source, 'persona', personaGap.missingValue),
      createdAt,
    }),
  ];
}
