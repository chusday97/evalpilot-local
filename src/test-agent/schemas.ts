import { z } from 'zod';
import { interactionActionSchema } from '../schemas/ux-evaluation.js';

export const groundedElementSchema = z.object({
  elementId: z.string().regex(/^E\d{3}$/),
  role: z.string().nullable(),
  tagName: z.string().min(1),
  label: z.string(),
  text: z.string().nullable(),
  placeholder: z.string().nullable(),
  disabled: z.boolean(),
  risk: z.enum(['safe', 'sensitive', 'high']),
  locatorHint: z.string().regex(/^grounded-index:\d+$/),
}).strict();

export const groundedFieldSchema = groundedElementSchema.extend({
  fieldName: z.string().nullable(),
  inputType: z.string().min(1),
  required: z.boolean(),
  currentValuePresent: z.boolean(),
  options: z.array(z.string()),
}).strict();

export const pageObservationSchema = z.object({
  observationId: z.string().min(1),
  pageUrl: z.string().url(),
  pagePurpose: z.string(),
  visibleStateSummary: z.string(),
  primaryAreas: z.array(z.string()),
  visibleProblems: z.array(z.string()),
  interactableElements: z.array(groundedElementSchema),
  formFields: z.array(groundedFieldSchema),
  evidenceRefs: z.array(z.string()),
  confidence: z.number().min(0).max(1),
}).strict();

export const agentDecisionSchema = z.object({
  intentSummary: z.string().min(1),
  action: z.enum(['click', 'fill', 'select', 'scroll', 'back', 'wait', 'retry', 'finish', 'abandon']),
  targetElementId: z.string().regex(/^E\d{3}$/).nullable(),
  value: z.string().nullable(),
  expectedResult: z.string().min(1),
  confidence: z.number().min(0).max(1),
}).strict().superRefine((value, context) => {
  const targetRequired = ['click', 'fill', 'select'].includes(value.action);
  if (targetRequired && value.targetElementId === null) context.addIssue({ code: 'custom', path: ['targetElementId'], message: '该动作必须引用一个 DOM 元素。' });
  if (!targetRequired && value.targetElementId !== null) context.addIssue({ code: 'custom', path: ['targetElementId'], message: '该动作不应引用 DOM 元素。' });
});

export const stepVerificationSchema = z.object({
  verificationId: z.string().min(1),
  expectation: z.string().min(1),
  observed: z.string().min(1),
  status: z.enum(['confirmed', 'not_confirmed', 'inconclusive']),
  evidenceRefs: z.array(z.string()),
  confidence: z.number().min(0).max(1),
}).strict();

export const stepEvidenceSchema = z.object({
  stepIndex: z.number().int().positive(),
  beforeObservationId: z.string().min(1),
  afterObservationId: z.string().min(1),
  beforeScreenshotPath: z.string().min(1),
  afterScreenshotPath: z.string().min(1),
  decisionId: z.string().min(1),
  verificationId: z.string().min(1),
  actionStatus: z.enum(['executed', 'blocked_by_safety', 'failed']),
}).strict();

export const evidenceCompletenessSchema = z.object({
  complete: z.boolean(),
  hasInitialObservation: z.boolean(),
  hasFinalObservation: z.boolean(),
  hasBeforeAfterScreenshots: z.boolean(),
  hasStepVerifications: z.boolean(),
  hasTrace: z.boolean(),
  missing: z.array(z.string().min(1)),
}).strict();

export const reflectionDecisionSchema = z.object({
  nextStep: z.enum(['continue', 'retry', 'backtrack', 'seek_another_path', 'finish', 'abandon']),
  summary: z.string().min(1),
  confidence: z.number().min(0).max(1),
}).strict();

export const runVersionMetadataSchema = z.object({
  targetAppGitSha: z.string().min(1).nullable(),
  productModelVersion: z.number().int().positive(),
  evalSetVersion: z.number().int().positive(),
  caseVersion: z.number().int().positive(),
  evalPilotVersion: z.string().min(1),
  actorModel: z.string().min(1),
  judgeModel: z.string().min(1),
  actorPromptVersion: z.string().min(1),
  judgePromptVersion: z.string().min(1),
  toolSchemaVersion: z.string().min(1),
  timestamp: z.iso.datetime(),
}).strict();

export const currentEvidencePacketSchema = z.object({
  runId: z.string().min(1), caseId: z.string().min(1), targetAppCommit: z.string().min(1).nullable(), actorModel: z.string().min(1), actorPromptVersion: z.string().min(1), startedAt: z.iso.datetime(), completedAt: z.iso.datetime(),
  actions: z.array(interactionActionSchema), observations: z.array(pageObservationSchema), stepVerifications: z.array(stepVerificationSchema), stepEvidence: z.array(stepEvidenceSchema), screenshots: z.array(z.string()), tracePath: z.string().nullable(), evidenceCompleteness: evidenceCompletenessSchema, consoleEvidence: z.array(z.string()), networkEvidence: z.array(z.string()),
  finalState: z.object({ url: z.string().min(1), visibleTextSummary: z.string() }).strict(), versions: runVersionMetadataSchema,
}).strict();

const legacyEvidencePacketSchema = z.object({
  runId: z.string().min(1), caseId: z.string().min(1), targetAppCommit: z.string().min(1).nullable(), actorModel: z.string().min(1), actorPromptVersion: z.string().min(1), startedAt: z.iso.datetime(), completedAt: z.iso.datetime(),
  actions: z.array(interactionActionSchema), observations: z.array(pageObservationSchema.omit({ observationId: true })), stepVerifications: z.array(stepVerificationSchema.omit({ verificationId: true })), screenshots: z.array(z.string()), tracePath: z.string().nullable(), consoleEvidence: z.array(z.string()), networkEvidence: z.array(z.string()),
  finalState: z.object({ url: z.string().min(1), visibleTextSummary: z.string() }).strict(), versions: runVersionMetadataSchema.optional(),
}).strict().transform((packet) => ({
  ...packet,
  versions: packet.versions ?? { targetAppGitSha: packet.targetAppCommit, productModelVersion: 1, evalSetVersion: 1, caseVersion: 1, evalPilotVersion: 'legacy-unknown', actorModel: packet.actorModel, judgeModel: 'legacy-unknown', actorPromptVersion: packet.actorPromptVersion, judgePromptVersion: 'legacy-unknown', toolSchemaVersion: 'legacy-unknown', timestamp: packet.startedAt },
  observations: packet.observations.map((observation, index) => ({ ...observation, observationId: `legacy-observation-${String(index + 1).padStart(3, '0')}` })),
  stepVerifications: packet.stepVerifications.map((verification, index) => ({ ...verification, verificationId: `legacy-verification-${String(index + 1).padStart(3, '0')}` })),
  stepEvidence: [],
  evidenceCompleteness: {
    complete: false,
    hasInitialObservation: packet.observations.length > 0,
    hasFinalObservation: packet.observations.length > 0 && packet.finalState.url.length > 0 && packet.finalState.visibleTextSummary.length > 0,
    hasBeforeAfterScreenshots: false,
    hasStepVerifications: false,
    hasTrace: false,
    missing: ['旧记录缺少逐步前后证据，不能补推验证结论。'],
  },
}));

export const evidencePacketSchema = z.union([currentEvidencePacketSchema, legacyEvidencePacketSchema]);
