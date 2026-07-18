import { z } from 'zod';
import { evidenceClaimSchema } from './background.js';
import { approvalStatusSchema } from './blueprint.js';

export const confidenceSchema = z.enum(['low', 'medium', 'high']);
export const journeyStepTypeSchema = z.enum(['required', 'safety', 'explanation', 'mergeable', 'automatable', 'redundant']);
export const interactionTypeSchema = z.enum(['click', 'input', 'navigation', 'backtrack', 'retry', 'hesitation', 'error', 'abandon']);
export const uxIssueTypeSchema = z.enum([
  'functional_bug',
  'journey_breakpoint',
  'discoverability_issue',
  'usability_issue',
  'path_efficiency_issue',
  'repeated_input_issue',
  'content_clarity_issue',
  'interaction_feedback_issue',
  'recovery_issue',
  'trust_issue',
  'accessibility_issue',
  'abandonment_risk',
]);

export const completionLayerSchema = z.object({
  conditions: z.array(z.string().min(1)).min(1),
  complete: z.boolean().nullable(),
  evidence: z.array(z.string().min(1)),
}).strict();

export const completionDefinitionSchema = z.object({
  technical: completionLayerSchema,
  interface: completionLayerSchema,
  userGoal: completionLayerSchema,
  followUp: completionLayerSchema,
}).strict();

export const journeyStepDefinitionSchema = z.object({
  stepId: z.string().min(1),
  label: z.string().min(1),
  type: journeyStepTypeSchema,
  evidence: z.array(evidenceClaimSchema).min(1),
  approvalStatus: approvalStatusSchema,
}).strict();

export const featureJourneyGraphSchema = z.object({
  featureId: z.string().min(1),
  featureName: z.string().min(1),
  userGoal: z.string().min(1),
  entryPoints: z.array(z.string().min(1)).min(1),
  prerequisites: z.array(z.string().min(1)),
  primaryPath: z.array(z.string().min(1)).min(1),
  alternativePaths: z.array(z.array(z.string().min(1))),
  successEndStates: z.array(z.string().min(1)).min(1),
  failureEndStates: z.array(z.string().min(1)).min(1),
  deadEnds: z.array(z.string().min(1)),
  recoveryPaths: z.array(z.array(z.string().min(1))),
  steps: z.array(journeyStepDefinitionSchema).min(1),
  nextActions: z.array(z.string().min(1)).min(1),
  completionDefinition: completionDefinitionSchema,
  approvalStatus: approvalStatusSchema,
}).strict();

export const abandonmentPolicySchema = z.object({
  maxFailedAttempts: z.number().int().positive(),
  maxClarificationTurns: z.number().int().nonnegative(),
  maxIdleTimeMs: z.number().int().positive(),
  maxTotalActions: z.number().int().positive(),
  abandonOn: z.array(z.string().min(1)).min(1),
}).strict();

export const exploratoryScenarioSchema = z.object({
  caseId: z.string().min(1),
  type: z.literal('exploratory_user_journey'),
  title: z.string().min(1),
  capability: z.string().min(1),
  personaId: z.string().min(1),
  startingUrl: z.string().min(1),
  goal: z.string().min(1),
  knownInformation: z.record(z.string(), z.unknown()),
  allowedActions: z.array(z.string().min(1)).min(1),
  forbiddenActions: z.array(z.string().min(1)).min(1),
  successConditions: z.array(z.string().min(1)).min(1),
  failureConditions: z.array(z.string().min(1)).min(1),
  abandonmentPolicy: abandonmentPolicySchema,
  severityIfFailed: z.enum(['P0', 'P1', 'P2', 'P3']),
  approvalStatus: approvalStatusSchema,
}).strict();

export const interactionActionSchema = z.object({
  actionId: z.string().min(1),
  type: interactionTypeSchema,
  timestampMs: z.number().int().nonnegative(),
  page: z.string().min(1),
  target: z.string().nullable(),
  inputField: z.string().nullable(),
  inputLength: z.number().int().nonnegative().nullable(),
  inputFingerprint: z.string().nullable(),
  outcome: z.string().min(1),
  evidence: z.array(z.string().min(1)),
}).strict();

export const simulatedUserMetricsSchema = z.object({
  metricType: z.literal('simulated_user_run'),
  timeToFirstActionMs: z.number().int().nonnegative(),
  timeToFindEntryMs: z.number().int().nonnegative().nullable(),
  timeToFirstMeaningfulActionMs: z.number().int().nonnegative().nullable(),
  timeToCompleteMs: z.number().int().nonnegative().nullable(),
  totalActions: z.number().int().nonnegative(),
  requiredActions: z.number().int().nonnegative(),
  redundantActions: z.number().int().nonnegative(),
  clickCount: z.number().int().nonnegative(),
  inputCount: z.number().int().nonnegative(),
  pageTransitions: z.number().int().nonnegative(),
  backtrackCount: z.number().int().nonnegative(),
  retryCount: z.number().int().nonnegative(),
  repeatedInputCount: z.number().int().nonnegative(),
  deadClickCount: z.number().int().nonnegative(),
  clarificationCount: z.number().int().nonnegative(),
  deadEndCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  recoveryAttempts: z.number().int().nonnegative(),
  recoverySuccess: z.boolean(),
  taskCompleted: z.boolean(),
  fullLoopCompleted: z.boolean(),
  abandoned: z.boolean(),
  abandonmentReason: z.string().nullable(),
  finalConfidence: confidenceSchema,
}).strict();

export const journeyComparisonSchema = z.object({
  featureId: z.string().min(1),
  runId: z.string().min(1),
  idealActionCount: z.number().int().nonnegative(),
  actualActionCount: z.number().int().nonnegative(),
  shortestReasonableActionCount: z.number().int().nonnegative(),
  extraActionCount: z.number().int().nonnegative(),
  pageTransitions: z.number().int().nonnegative(),
  backtrackCount: z.number().int().nonnegative(),
  repeatedInputCount: z.number().int().nonnegative(),
  deadEndCount: z.number().int().nonnegative(),
  taskCompleted: z.boolean(),
  fullLoopCompleted: z.boolean(),
  evidence: z.array(z.string().min(1)),
}).strict();

export const frictionEventSchema = z.object({
  frictionId: z.string().min(1),
  type: uxIssueTypeSchema,
  featureId: z.string().min(1),
  page: z.string().min(1),
  step: z.string().min(1),
  persona: z.string().min(1),
  observedBehavior: z.string().min(1),
  possibleUserReason: z.string().startsWith('推测：'),
  evidence: z.array(z.string().min(1)),
  severity: z.enum(['P0', 'P1', 'P2', 'P3']),
  confidence: confidenceSchema,
}).strict();

export const journeyBreakpointSchema = z.object({
  breakpointId: z.string().min(1),
  featureId: z.string().min(1),
  journeyStage: z.string().min(1),
  persona: z.string().min(1),
  observedBehavior: z.string().min(1),
  expectedBehavior: z.string().min(1),
  userImpact: z.string().min(1),
  evidence: z.array(z.string().min(1)),
  severity: z.enum(['P0', 'P1', 'P2', 'P3']),
  confidence: confidenceSchema,
}).strict();

export const uxDimensionSchema = z.enum([
  'discoverability',
  'comprehension',
  'convenience',
  'interactionFeedback',
  'userControl',
  'errorRecovery',
  'journeyNaturalness',
  'systemTransparency',
  'interruptionTolerance',
  'accessibility',
  'goalCompletion',
  'followUpClarity',
]);

export const uxDimensionScoreSchema = z.object({
  dimension: uxDimensionSchema,
  score: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  evidence: z.array(z.string().min(1)),
  confidence: confidenceSchema,
  needsHumanReview: z.boolean(),
}).strict();

export const uxEvaluationResultSchema = z.object({
  runId: z.string().min(1),
  completion: completionDefinitionSchema,
  functionalStatus: z.enum(['passed', 'failed', 'blocked']),
  uxScores: z.array(uxDimensionScoreSchema).length(12),
  verdict: z.enum([
    'functional_and_ux_passed',
    'functional_passed_ux_failed',
    'functional_failed',
    'friction_non_blocking',
    'full_loop_failed',
    'needs_human_review',
  ]),
  authenticityNotice: z.array(z.string().min(1)).min(1),
}).strict();

export const issueLocationSchema = z.object({
  page: z.string().nullable(),
  stepIndex: z.number().int().nonnegative().nullable(),
  stepLabel: z.string().nullable(),
  target: z.string().nullable(),
  sourceFile: z.string().nullable(),
}).strict();

export const issueEvidenceItemSchema = z.object({
  evidenceId: z.string().min(1),
  type: z.enum(['screenshot', 'trace', 'console', 'network', 'interaction', 'file']),
  title: z.string().min(1),
  observation: z.string().min(1),
  sourcePath: z.string().min(1),
  relatedStepIndex: z.number().int().nonnegative().nullable(),
}).strict();

export const uxIssueSchema = z.object({
  issueId: z.string().min(1),
  type: uxIssueTypeSchema,
  severity: z.enum(['P0', 'P1', 'P2', 'P3']),
  featureId: z.string().min(1),
  personaId: z.string().min(1),
  caseId: z.string().min(1),
  userGoal: z.string().min(1),
  idealPath: z.array(z.string().min(1)),
  actualPath: z.array(z.string().min(1)),
  shortestReasonablePath: z.array(z.string().min(1)),
  failureOrAbandonmentPoint: z.string().nullable(),
  metrics: simulatedUserMetricsSchema,
  evidence: z.array(z.string().min(1)),
  recommendation: z.string().min(1),
  protectedSafetySteps: z.array(z.string().min(1)),
  confidence: confidenceSchema,
  needsHumanReview: z.boolean(),
  addedToRegression: z.boolean(),
  location: issueLocationSchema.nullable().optional(),
  evidenceItems: z.array(issueEvidenceItemSchema).optional(),
  causeHypothesis: z.string().nullable().optional(),
  resolutionSteps: z.array(z.string().min(1)).optional(),
  verificationSteps: z.array(z.string().min(1)).optional(),
}).strict();

export const beforeAfterComparisonSchema = z.object({
  comparisonId: z.string().min(1),
  issueId: z.string().min(1),
  beforeRunId: z.string().min(1),
  afterRunId: z.string().min(1),
  before: journeyComparisonSchema,
  after: journeyComparisonSchema,
  safetyConstraintsPreserved: z.boolean(),
  newIssueIds: z.array(z.string().min(1)),
  verdict: z.enum(['improved', 'unchanged', 'regressed', 'needs_human_review']),
  evidence: z.array(z.string().min(1)),
  comparedAt: z.iso.datetime(),
}).strict();
