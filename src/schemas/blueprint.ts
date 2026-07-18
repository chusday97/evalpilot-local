import { z } from 'zod';

export const approvalStatusSchema = z.enum(['draft', 'approved', 'needs_human_review']);
export const blueprintCapabilitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  importance: z.enum(['critical', 'high', 'medium', 'low']),
  userGoals: z.array(z.string()).min(1),
  entryPoints: z.array(z.string()).min(1),
  successConditions: z.array(z.string()).min(1),
  hardConstraints: z.array(z.string()).min(1),
  failureConditions: z.array(z.string()).min(1),
  dependencies: z.array(z.string()),
  requiredPersonas: z.array(z.string()).min(1),
  requiredInputQualities: z.array(z.string()).min(1),
  requiredSystemStates: z.array(z.string()).min(1),
  graders: z.array(z.string()).min(1),
  approvalStatus: approvalStatusSchema,
});

export const evalBlueprintSchema = z.object({
  projectName: z.string().min(1),
  inScope: z.array(z.string()).min(1),
  outOfScope: z.array(z.string()).min(1),
  capabilities: z.array(blueprintCapabilitySchema).min(1),
  scenarioDimensions: z.record(z.string(), z.array(z.string()).min(1)),
  scoring: z.object({
    hardAssertions: z.array(z.string()).min(1),
    rubricItems: z.array(z.string()).min(1),
  }),
  coverageTargets: z.record(z.string(), z.number().min(0).max(1)),
  releaseGates: z.array(z.string()).min(1),
  approvalStatus: approvalStatusSchema,
  generatedAt: z.iso.datetime(),
});
