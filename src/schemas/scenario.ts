import { z } from 'zod';
import { approvalStatusSchema } from './blueprint.js';

export const personaSchema = z.object({
  personaId: z.string().min(1),
  name: z.string().min(1),
  primaryGoal: z.string().min(1),
  knowledgeLevel: z.string().min(1),
  expressionQuality: z.string().min(1),
  patienceTurns: z.number().int().min(0),
  errorProbability: z.number().min(0).max(1),
  trustLevel: z.string().min(1),
  privacySensitivity: z.string().min(1),
  behaviorPolicy: z.array(z.string()).min(1),
  exitConditions: z.array(z.string()).min(1),
  supportedCapabilities: z.array(z.string()).min(1),
});

export const scenarioStepSchema = z.object({
  action: z.enum(['goto', 'click', 'fill', 'press', 'wait', 'assertVisible', 'assertUrl', 'injectFault']),
  target: z.string().optional(),
  value: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export const scenarioSchema = z.object({
  caseId: z.string().min(1),
  title: z.string().min(1),
  capability: z.string().min(1),
  persona: z.string().min(1),
  intentType: z.string().min(1),
  inputQuality: z.string().min(1),
  systemState: z.string().min(1),
  journeyStage: z.string().min(1),
  goal: z.string().min(1),
  preconditions: z.array(z.string()),
  input: z.record(z.string(), z.unknown()),
  steps: z.array(scenarioStepSchema),
  expectedBehavior: z.array(z.string()).min(1),
  forbiddenBehavior: z.array(z.string()).min(1),
  hardAssertions: z.array(z.string()).min(1),
  rubric: z.array(z.string()).min(1),
  severityIfFailed: z.enum(['P0', 'P1', 'P2', 'P3']),
  source: z.string().min(1),
  approvalStatus: approvalStatusSchema,
  automationStatus: z.enum(['manual', 'automated']),
});
