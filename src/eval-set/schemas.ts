import { z } from 'zod';

export const storageIdSchema = z.string().min(1).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
export const evalSetTypeSchema = z.enum(['baseline', 'regression', 'challenge', 'exploratory']);
export const evalCaseLifecycleStatusSchema = z.enum(['candidate', 'active', 'stable', 'retired']);
export const evalVerdictSchema = z.enum(['pass', 'fail', 'inconclusive']);
export const coverageDimensionSchema = z.enum(['capability', 'persona', 'input_quality', 'system_state', 'journey_stage', 'risk', 'recovery', 'interaction_pattern', 'ai_output']);

export const evalPersonaRefSchema = z.object({
  personaId: storageIdSchema,
  name: z.string().min(1),
  knowledgeLevel: z.enum(['low', 'medium', 'high']).default('medium'),
  patienceTurns: z.number().int().min(1).max(20).default(3),
  retryTolerance: z.number().int().min(0).max(10).default(1),
  privacySensitivity: z.enum(['low', 'medium', 'high']).default('medium'),
  behaviorPolicy: z.array(z.string().min(1)),
  exitConditions: z.array(z.string().min(1)).default(['证据不足时退出']),
}).strict();

export const deterministicAssertionSchema = z.object({
  assertionId: storageIdSchema,
  type: z.enum(['url_matches', 'text_visible', 'text_absent', 'request_observed', 'console_error_absent', 'state_persisted']),
  target: z.string().min(1),
  expected: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  negated: z.boolean(),
}).strict();

export const evalOracleSchema = z.object({
  expectedOutcome: z.array(z.string().min(1)).min(1),
  mustObserve: z.array(z.string().min(1)),
  mustNotObserve: z.array(z.string().min(1)),
  businessRules: z.array(z.string().min(1)),
  semanticRubric: z.array(z.string().min(1)).min(1),
  deterministicAssertions: z.array(deterministicAssertionSchema),
  inconclusiveWhen: z.array(z.string().min(1)).min(1),
  aiOutputCriteria: z.array(z.object({ type: z.enum(['relevance', 'factuality', 'consistency', 'instruction_following', 'uncertainty_expression', 'citation_quality', 'hallucination', 'safety', 'format_correctness']), description: z.string().min(1), referenceAnswer: z.string().min(1).nullable(), humanReviewRequired: z.boolean() }).strict()).optional(),
}).strict();

export const evalCaseOriginSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('generated_from_product_model'), productModelVersion: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('generated_from_coverage_gap'), sourceCaseIds: z.array(storageIdSchema), gapId: storageIdSchema }).strict(),
  z.object({ type: z.literal('badcase'), issueId: storageIdSchema, badcaseId: storageIdSchema, firstFailedRunId: storageIdSchema }).strict(),
  z.object({ type: z.literal('human'), note: z.string().min(1) }).strict(),
]);

export const coverageDimensionValueSchema = z.object({
  dimension: coverageDimensionSchema,
  value: z.string().min(1),
}).strict();

export const regressionMetadataSchema = z.object({
  badcaseId: storageIdSchema,
  issueId: storageIdSchema,
  firstFailedAt: z.iso.datetime(),
  fixedAt: z.iso.datetime(),
  originalFailure: z.string().min(1),
  sourceRunId: storageIdSchema,
  fixTaskId: storageIdSchema.nullable(),
}).strict();

export const evalCaseStatsSchema = z.object({
  passCount: z.number().int().nonnegative(),
  failCount: z.number().int().nonnegative(),
  inconclusiveCount: z.number().int().nonnegative(),
  latestResult: evalVerdictSchema.nullable(),
  latestRunId: storageIdSchema.nullable(),
  uniqueCoverageContribution: z.number().nonnegative(),
  lastExecutedAt: z.iso.datetime().nullable(),
}).strict();

export const evalCaseSchema = z.object({
  caseId: storageIdSchema,
  projectId: storageIdSchema,
  setType: evalSetTypeSchema,
  status: evalCaseLifecycleStatusSchema,
  origin: evalCaseOriginSchema,
  capabilityId: storageIdSchema,
  taskId: storageIdSchema.nullable(),
  title: z.string().min(1),
  hypothesis: z.string().min(1),
  persona: evalPersonaRefSchema,
  goal: z.string().min(1),
  knownInformation: z.record(z.string(), z.unknown()),
  preconditions: z.array(z.string().min(1)),
  oracle: evalOracleSchema,
  coverageDimensions: z.array(coverageDimensionValueSchema),
  riskLevel: z.enum(['P0', 'P1', 'P2', 'P3']),
  generationReason: z.string().min(1),
  version: z.number().int().positive(),
  stats: evalCaseStatsSchema,
  regressionMetadata: regressionMetadataSchema.nullable(),
  retirementReason: z.string().min(1).nullable(),
  needsHumanReview: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict().superRefine((value, context) => {
  if (value.setType === 'regression' && value.regressionMetadata === null) {
    context.addIssue({ code: 'custom', path: ['regressionMetadata'], message: 'Regression 案例必须包含来源信息。' });
  }
  if (value.setType !== 'regression' && value.regressionMetadata !== null) {
    context.addIssue({ code: 'custom', path: ['regressionMetadata'], message: '只有 Regression 案例可包含来源信息。' });
  }
  if (value.status === 'retired' && value.retirementReason === null) {
    context.addIssue({ code: 'custom', path: ['retirementReason'], message: '退役案例必须说明原因。' });
  }
});

export const evalSetCaseReferenceSchema = z.object({
  caseId: storageIdSchema,
  setType: evalSetTypeSchema,
  status: evalCaseLifecycleStatusSchema,
  version: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
}).strict();

export const evalSetManifestSchema = z.object({
  projectId: storageIdSchema,
  version: z.number().int().positive(),
  generatedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  cases: z.array(evalSetCaseReferenceSchema),
}).strict();

export const coverageDimensionSummarySchema = z.object({
  dimension: coverageDimensionSchema,
  targetValues: z.array(z.string().min(1)),
  coveredValues: z.array(z.string().min(1)),
  missingValues: z.array(z.string().min(1)),
  coverageRatio: z.number().min(0).max(1),
}).strict();

export const coverageGapSchema = z.object({
  gapId: storageIdSchema,
  kind: z.enum(['missing_asset', 'not_executed', 'not_verified', 'inconclusive', 'failed']),
  capabilityId: storageIdSchema,
  dimension: coverageDimensionSchema,
  missingValue: z.string().min(1),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  reason: z.string().min(1),
  candidateCaseIds: z.array(storageIdSchema),
}).strict();

export const coverageCellSchema = z.object({
  cellId: storageIdSchema,
  capabilityId: storageIdSchema,
  dimension: coverageDimensionSchema,
  value: z.string().min(1),
  assetStatus: z.enum(['missing', 'candidate', 'stable']),
  executionStatus: z.enum(['not_run', 'pass', 'fail', 'inconclusive']),
  caseIds: z.array(storageIdSchema),
  latestRunId: storageIdSchema.nullable(),
  latestResultAt: z.iso.datetime().nullable(),
  verified: z.boolean(),
}).strict();

export const coverageMatrixSchema = z.object({
  projectId: storageIdSchema,
  generatedAt: z.iso.datetime(),
  dimensions: z.array(coverageDimensionSummarySchema),
  gaps: z.array(coverageGapSchema),
  totalTargetCells: z.number().int().nonnegative(),
  assetCoveredCells: z.number().int().nonnegative(),
  executedCells: z.number().int().nonnegative(),
  verifiedCells: z.number().int().nonnegative(),
  coveredCells: z.number().int().nonnegative(),
  assetCoverageRatio: z.number().min(0).max(1),
  executionCoverageRatio: z.number().min(0).max(1),
  verifiedCoverageRatio: z.number().min(0).max(1),
  cells: z.array(coverageCellSchema),
  coverageRatio: z.number().min(0).max(1),
}).strict().superRefine((value, context) => {
  for (const field of ['assetCoveredCells', 'executedCells', 'verifiedCells', 'coveredCells'] as const) {
    if (value[field] > value.totalTargetCells) context.addIssue({ code: 'custom', path: [field], message: '覆盖单元不能超过目标单元。' });
  }
  if (value.coveredCells !== value.verifiedCells || value.coverageRatio !== value.verifiedCoverageRatio) context.addIssue({ code: 'custom', path: ['coverageRatio'], message: '废弃覆盖字段必须与已验证覆盖一致。' });
  if (value.cells.length === 0) {
    if (value.executedCells !== 0 || value.verifiedCells !== 0) context.addIssue({ code: 'custom', path: ['cells'], message: '没有功能级单元的兼容记录不能声明已执行或已验证覆盖。' });
    return;
  }
  if (value.cells.length !== value.totalTargetCells) context.addIssue({ code: 'custom', path: ['cells'], message: '功能级覆盖单元数量必须等于目标单元数量。' });
  const counts = {
    assetCoveredCells: value.cells.filter((cell) => cell.assetStatus !== 'missing').length,
    executedCells: value.cells.filter((cell) => cell.executionStatus !== 'not_run').length,
    verifiedCells: value.cells.filter((cell) => cell.verified).length,
  };
  for (const field of ['assetCoveredCells', 'executedCells', 'verifiedCells'] as const) {
    if (value[field] !== counts[field]) context.addIssue({ code: 'custom', path: [field], message: '覆盖计数必须与功能级单元一致。' });
  }
  const expectedRatio = (count: number) => value.totalTargetCells ? count / value.totalTargetCells : 1;
  for (const [field, count] of [['assetCoverageRatio', counts.assetCoveredCells], ['executionCoverageRatio', counts.executedCells], ['verifiedCoverageRatio', counts.verifiedCells]] as const) {
    if (Math.abs(value[field] - expectedRatio(count)) > Number.EPSILON) context.addIssue({ code: 'custom', path: [field], message: '覆盖率必须与功能级单元一致。' });
  }
});

export const legacyCoverageMatrixSchema = z.object({
  projectId: storageIdSchema,
  generatedAt: z.iso.datetime(),
  dimensions: z.array(coverageDimensionSummarySchema),
  gaps: z.array(z.object({
    gapId: storageIdSchema,
    capabilityId: storageIdSchema,
    dimension: coverageDimensionSchema,
    missingValue: z.string().min(1),
    priority: z.enum(['critical', 'high', 'medium', 'low']),
    reason: z.string().min(1),
    candidateCaseIds: z.array(storageIdSchema),
  }).strict()),
  totalTargetCells: z.number().int().nonnegative(),
  coveredCells: z.number().int().nonnegative(),
  coverageRatio: z.number().min(0).max(1),
}).strict();

export const passAnalysisSchema = z.object({
  confirmedConditions: z.array(coverageDimensionValueSchema),
  remainingGaps: z.array(coverageGapSchema),
  challengeCandidates: z.array(evalCaseSchema),
}).strict();

export const explorationHypothesisSchema = z.object({
  hypothesisId: storageIdSchema,
  title: z.string().min(1),
  rationale: z.string().min(1),
  capabilityId: storageIdSchema,
  goal: z.string().min(1),
  riskLevel: z.enum(['P0', 'P1', 'P2', 'P3']),
  coverageDimensions: z.array(coverageDimensionValueSchema),
  safeActions: z.array(z.string().min(1)),
  status: z.enum(['proposed', 'testing', 'confirmed', 'rejected', 'inconclusive']),
}).strict();

export const explorationPlanSchema = z.object({
  scopeSummary: z.string().min(1),
  hypotheses: z.array(explorationHypothesisSchema),
  rejectedForSafety: z.array(z.string().min(1)),
}).strict();

export const explorationFindingSchema = z.object({
  findingId: storageIdSchema,
  hypothesisId: storageIdSchema,
  verdict: evalVerdictSchema,
  summary: z.string().min(1),
  evidenceRefs: z.array(z.string()),
  uniqueCoverageContribution: z.number().nonnegative(),
  reusable: z.boolean(),
  promotionEligible: z.boolean(),
  promotionReason: z.string().min(1),
}).strict();

export const benchmarkIssueSchema = z.object({
  issueId: storageIdSchema,
  category: z.enum(['functional', 'navigation', 'interaction', 'ux', 'state', 'api', 'data', 'auth', 'ai_output', 'prompt', 'rag', 'tool', 'safety', 'performance', 'evaluator', 'unknown']),
  severity: z.enum(['P0', 'P1', 'P2', 'P3']),
  summary: z.string().min(1),
}).strict();

export const benchmarkGroundTruthSchema = z.object({ fixtureId: storageIdSchema, expectedIssues: z.array(benchmarkIssueSchema), forbiddenFalsePositives: z.array(z.string().min(1)) }).strict();
export const benchmarkObservationSchema = z.object({ interactionAttempted: z.boolean(), stableFeedback: z.boolean(), urlChanged: z.boolean(), statePersisted: z.boolean(), networkStatus: z.number().int().min(0).max(599), duplicateRequests: z.number().int().nonnegative(), nextActionVisible: z.boolean(), timedOut: z.boolean(), aiOutputRelevant: z.boolean(), destructiveActionBlocked: z.boolean() }).strict();
export const benchmarkFixtureSchema = z.object({ groundTruth: benchmarkGroundTruthSchema, title: z.string().min(1), observation: benchmarkObservationSchema }).strict();
export const benchmarkPredictionSchema = z.object({ fixtureId: storageIdSchema, issues: z.array(benchmarkIssueSchema), evaluatorFailure: z.boolean() }).strict();
export const benchmarkMetricsSchema = z.object({ total: z.number().int().nonnegative(), knownFailures: z.number().int().nonnegative(), cleanBehaviors: z.number().int().nonnegative(), truePositives: z.number().int().nonnegative(), falsePositives: z.number().int().nonnegative(), falseNegatives: z.number().int().nonnegative(), trueNegatives: z.number().int().nonnegative(), bugDetectionRecall: z.number().min(0).max(1), precision: z.number().min(0).max(1), falsePositiveRate: z.number().min(0).max(1), classificationAccuracy: z.number().min(0).max(1), evaluatorFailureRate: z.number().min(0).max(1) }).strict();
export const benchmarkReportSchema = z.object({ benchmarkVersion: z.string().min(1), generatedAt: z.iso.datetime(), metrics: benchmarkMetricsSchema, predictions: z.array(benchmarkPredictionSchema), limitation: z.string().min(1) }).strict();
