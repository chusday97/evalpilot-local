import { z } from 'zod';

export const factStatusSchema = z.enum(['verified', 'declared', 'inferred', 'unknown']);
export const evidenceClaimSchema = z.object({
  claim: z.string().min(1),
  sourceType: z.enum(['repository', 'document', 'git', 'browser', 'user']),
  source: z.string().min(1),
  status: factStatusSchema,
});

export const capabilitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  status: factStatusSchema,
  routes: z.array(z.string()),
  evidence: z.array(evidenceClaimSchema).min(1),
  dependencies: z.array(z.string()),
  risks: z.array(z.string()),
});

export const projectBackgroundSchema = z.object({
  projectName: z.string().min(1),
  projectType: z.string().min(1),
  currentStatus: factStatusSchema,
  problem: z.string().min(1),
  targetUsers: z.array(z.string()).min(1),
  userTasks: z.array(z.string()).min(1),
  capabilities: z.array(capabilitySchema).min(1),
  corePages: z.array(z.string()),
  primaryJourneys: z.array(z.string()),
  aiResponsibilities: z.array(z.string()),
  ruleResponsibilities: z.array(z.string()),
  externalDependencies: z.array(z.string()),
  highRiskOperations: z.array(z.string()),
  knownLimitations: z.array(z.string()),
  assumptions: z.array(z.string()),
  unknowns: z.array(z.string()),
  evidence: z.array(evidenceClaimSchema).min(1),
  fieldStatuses: z.record(z.string(), factStatusSchema),
  fieldEvidence: z.record(z.string(), z.array(evidenceClaimSchema).min(1)),
  generatedAt: z.iso.datetime(),
});
