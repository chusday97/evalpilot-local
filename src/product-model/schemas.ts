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
  businessRules: z.array(businessRuleSchema),
  knownRisks: z.array(knownRiskSchema),
  unknowns: z.array(productUnknownSchema),
  evidence: z.array(evidenceClaimSchema),
}).strict();
