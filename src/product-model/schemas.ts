import { z } from 'zod';
import { evidenceClaimSchema, factStatusSchema } from '../schemas/background.js';

const idSchema = z.string().min(1).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const severitySchema = z.enum(['P0', 'P1', 'P2', 'P3']);

export const productUserTypeSchema = z.object({
  userTypeId: idSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  goals: z.array(z.string().min(1)),
  evidenceStatus: factStatusSchema,
  evidence: z.array(evidenceClaimSchema),
  needsHumanReview: z.boolean(),
}).strict();

export const productCapabilitySchema = z.object({
  capabilityId: idSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  routes: z.array(z.string()),
  entryPoints: z.array(z.string()),
  userGoals: z.array(z.string().min(1)),
  supportedTasks: z.array(idSchema),
  importance: z.enum(['critical', 'high', 'medium', 'low']),
  evidenceStatus: factStatusSchema,
  evidence: z.array(evidenceClaimSchema),
  needsHumanReview: z.boolean(),
}).strict();

export const productTaskSchema = z.object({
  taskId: idSchema,
  capabilityId: idSchema,
  name: z.string().min(1),
  goal: z.string().min(1),
  preconditions: z.array(z.string().min(1)),
  successConditions: z.array(z.string().min(1)),
  successSignals: z.array(z.object({
    signalId: idSchema,
    kind: z.enum(['text_visible', 'text_absent', 'url_matches', 'request_observed', 'console_error_absent', 'state_persisted', 'semantic']),
    target: z.string().min(1),
    description: z.string().min(1),
    evidenceStatus: factStatusSchema,
    evidence: z.array(evidenceClaimSchema),
    needsHumanReview: z.boolean(),
  }).strict()).optional(),
  businessRuleIds: z.array(idSchema).optional(),
  evidenceStatus: factStatusSchema,
  evidence: z.array(evidenceClaimSchema),
  needsHumanReview: z.boolean(),
}).strict();

export const productObjectLifecycleSchema = z.object({
  lifecycleId: idSchema,
  objectName: z.string().min(1),
  states: z.array(z.string().min(1)).min(1),
  transitions: z.array(z.object({
    transitionId: idSchema,
    fromState: z.string().min(1),
    toState: z.string().min(1),
    trigger: z.string().min(1),
    successSignalIds: z.array(idSchema),
  }).strict()),
  evidenceStatus: factStatusSchema,
  evidence: z.array(evidenceClaimSchema),
  needsHumanReview: z.boolean(),
}).strict();

export const productJourneySchema = z.object({
  journeyId: idSchema,
  name: z.string().min(1),
  taskIds: z.array(idSchema).min(1),
  routes: z.array(z.string()),
  successConditions: z.array(z.string().min(1)).min(1),
  evidenceStatus: factStatusSchema,
  evidence: z.array(evidenceClaimSchema),
  needsHumanReview: z.boolean(),
}).strict();

export const businessRuleSchema = z.object({
  ruleId: idSchema,
  statement: z.string().min(1),
  evidenceStatus: factStatusSchema,
  evidence: z.array(evidenceClaimSchema),
  needsHumanReview: z.boolean(),
}).strict();

export const knownRiskSchema = z.object({
  riskId: idSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  severity: severitySchema,
  evidenceStatus: factStatusSchema,
  evidence: z.array(evidenceClaimSchema),
  needsHumanReview: z.boolean(),
}).strict();

export const productUnknownSchema = z.object({
  unknownId: idSchema,
  question: z.string().min(1),
  impact: z.string().min(1),
  resolutionHint: z.string().min(1),
}).strict();

export const productModelSchema = z.object({
  projectId: idSchema,
  version: z.number().int().positive(),
  generatedAt: z.iso.datetime(),
  productName: z.string().min(1),
  productType: z.string().min(1),
  targetUsers: z.array(productUserTypeSchema),
  capabilities: z.array(productCapabilitySchema),
  userTasks: z.array(productTaskSchema),
  objectLifecycles: z.array(productObjectLifecycleSchema).optional(),
  crossPageJourneys: z.array(productJourneySchema).optional(),
  businessRules: z.array(businessRuleSchema),
  knownRisks: z.array(knownRiskSchema),
  unknowns: z.array(productUnknownSchema),
  evidence: z.array(evidenceClaimSchema),
}).strict();

const evidenceReferenceFields = {
  evidenceStatus: factStatusSchema,
  evidenceRefs: z.array(idSchema),
  needsHumanReview: z.boolean(),
} as const;

export const productUnderstandingDraftSchema = z.object({
  capabilities: z.array(z.object({
    capabilityId: idSchema,
    name: z.string().min(1),
    description: z.string().min(1),
    routes: z.array(z.string()),
    entryPoints: z.array(z.string()),
    userGoals: z.array(z.string().min(1)).min(1),
    importance: z.enum(['critical', 'high', 'medium', 'low']),
    ...evidenceReferenceFields,
  }).strict()).min(1),
  userTasks: z.array(z.object({
    taskId: idSchema,
    capabilityId: idSchema,
    name: z.string().min(1),
    goal: z.string().min(1),
    preconditions: z.array(z.string().min(1)),
    successConditions: z.array(z.string().min(1)).min(1),
    successSignals: z.array(z.object({
      signalId: idSchema,
      kind: z.enum(['text_visible', 'text_absent', 'url_matches', 'request_observed', 'console_error_absent', 'state_persisted', 'semantic']),
      target: z.string().min(1),
      description: z.string().min(1),
      ...evidenceReferenceFields,
    }).strict()).min(1),
    businessRuleIds: z.array(idSchema),
    ...evidenceReferenceFields,
  }).strict()).min(1),
  objectLifecycles: z.array(z.object({
    lifecycleId: idSchema,
    objectName: z.string().min(1),
    states: z.array(z.string().min(1)).min(1),
    transitions: z.array(z.object({ transitionId: idSchema, fromState: z.string().min(1), toState: z.string().min(1), trigger: z.string().min(1), successSignalIds: z.array(idSchema) }).strict()),
    ...evidenceReferenceFields,
  }).strict()),
  crossPageJourneys: z.array(z.object({
    journeyId: idSchema,
    name: z.string().min(1),
    taskIds: z.array(idSchema).min(1),
    routes: z.array(z.string()),
    successConditions: z.array(z.string().min(1)).min(1),
    ...evidenceReferenceFields,
  }).strict()),
  businessRules: z.array(z.object({ ruleId: idSchema, statement: z.string().min(1), ...evidenceReferenceFields }).strict()),
  unknowns: z.array(z.object({ unknownId: idSchema, question: z.string().min(1), impact: z.string().min(1), resolutionHint: z.string().min(1) }).strict()),
}).strict();
