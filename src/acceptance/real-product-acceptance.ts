import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const expectedPrerequisiteSchema = z.enum(['none', 'auth', 'setup', 'file', 'human']);

export const realProductAcceptanceManifestSchema = z.object({
  schemaVersion: z.literal(1),
  product: z.object({
    name: z.string().min(1),
    repository: z.string().min(1),
    commit: z.string().regex(/^[0-9a-f]{40}$/),
    startCommand: z.string().min(1),
    targetUrl: z.url(),
    contractSources: z.array(z.string().min(1)).min(1),
  }).strict(),
  thresholds: z.object({
    requiredPasses: z.number().int().nonnegative(),
    maxEvaluatorFailures: z.number().int().nonnegative(),
    maxPrerequisiteBlocks: z.number().int().nonnegative(),
    maxNotRun: z.number().int().nonnegative(),
  }).strict(),
  tasks: z.array(z.object({
    acceptanceTaskId: z.string().min(1),
    name: z.string().min(1),
    goalIncludes: z.array(z.string().min(1)).min(1),
    routeIncludes: z.string().min(1).optional(),
    expectedPrerequisite: expectedPrerequisiteSchema,
    acceptanceIntent: z.string().min(1),
    evidenceBasis: z.array(z.string().min(1)).min(1),
  }).strict()).min(1),
}).strict().superRefine((manifest, ctx) => {
  if (manifest.thresholds.requiredPasses > manifest.tasks.length) {
    ctx.addIssue({ code: 'custom', path: ['thresholds', 'requiredPasses'], message: 'requiredPasses 不能大于任务数量。' });
  }
  const ids = manifest.tasks.map((task) => task.acceptanceTaskId);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: 'custom', path: ['tasks'], message: 'acceptanceTaskId 必须唯一。' });
  }
});

export type RealProductAcceptanceManifest = z.infer<typeof realProductAcceptanceManifestSchema>;

const scenarioPreflightSchema = z.object({
  blockedCaseIds: z.array(z.string()).default([]),
  prerequisitePlans: z.array(z.object({
    caseId: z.string(),
    status: z.string(),
    reasons: z.array(z.string()).optional(),
    unresolvedBlockers: z.array(z.object({
      type: z.string(),
      summary: z.string().optional(),
      sourceValue: z.string().optional(),
    }).passthrough()).optional(),
  }).passthrough()).default([]),
  scenarios: z.array(z.object({
    caseId: z.string(),
    goal: z.string(),
    startingUrl: z.string().optional(),
  }).passthrough()).default([]),
}).passthrough();

const adaptiveReportSubsetSchema = z.object({
  caseResults: z.array(z.object({
    caseId: z.string(),
    verdict: z.enum(['pass', 'fail', 'inconclusive']),
    failureSource: z.string().nullable().optional(),
    semantic: z.object({ summary: z.string().optional() }).passthrough().optional(),
  }).passthrough()).default([]),
}).passthrough();

const foundationQualitySubsetSchema = z.object({
  quality: z.enum(['ready', 'degraded', 'invalid']),
  warnings: z.array(z.string()).optional(),
}).passthrough();

export type AcceptanceTaskStatus =
  | 'pass'
  | 'product_failure'
  | 'evaluator_failure'
  | 'prerequisite_blocked'
  | 'not_run'
  | 'not_generated'
  | 'ambiguous_scenario'
  | 'foundation_blocked';

export interface RealProductAcceptanceTaskResult {
  acceptanceTaskId: string;
  name: string;
  status: AcceptanceTaskStatus;
  caseId: string | null;
  reason: string;
}

export interface RealProductAcceptanceGateResult {
  product: string;
  repository: string;
  commit: string;
  passed: boolean;
  taskCompletionRate: number;
  counts: {
    planned: number;
    passed: number;
    productFailures: number;
    evaluatorFailures: number;
    prerequisiteBlocks: number;
    notRun: number;
    notGenerated: number;
    ambiguous: number;
    foundationBlocked: number;
  };
  tasks: RealProductAcceptanceTaskResult[];
  failedThresholds: string[];
}

const normalize = (value: string) => value.trim().toLocaleLowerCase();

function matchesGoal(goal: string, includes: string[]): boolean {
  const normalizedGoal = normalize(goal);
  return includes.every((token) => normalizedGoal.includes(normalize(token)));
}

function blockerReason(preflight: z.infer<typeof scenarioPreflightSchema>, caseId: string): string {
  const plan = preflight.prerequisitePlans.find((item) => item.caseId === caseId);
  if (!plan) return 'Scenario Preflight 将该案例标记为 blocked。';
  const blockers = (plan.unresolvedBlockers ?? []).map((item) => [item.summary, item.sourceValue].filter(Boolean).join('：')).filter(Boolean);
  return [...(plan.reasons ?? []), ...blockers].join('；') || `Prerequisite Plan 状态为 ${plan.status}。`;
}

export async function loadRealProductAcceptanceManifest(path: string): Promise<RealProductAcceptanceManifest> {
  return realProductAcceptanceManifestSchema.parse(parseYaml(await readFile(path, 'utf8')));
}

export function evaluateRealProductAcceptance(input: {
  manifest: RealProductAcceptanceManifest;
  preflight: unknown;
  report: unknown;
  foundationQuality?: unknown;
}): RealProductAcceptanceGateResult {
  const manifest = realProductAcceptanceManifestSchema.parse(input.manifest);
  const preflight = scenarioPreflightSchema.parse(input.preflight);
  const report = adaptiveReportSubsetSchema.parse(input.report);
  const foundation = input.foundationQuality === undefined ? null : foundationQualitySubsetSchema.parse(input.foundationQuality);
  const resultByCaseId = new Map(report.caseResults.map((item) => [item.caseId, item]));
  const blockedCaseIds = new Set(preflight.blockedCaseIds);

  const tasks: RealProductAcceptanceTaskResult[] = manifest.tasks.map((task) => {
    if (foundation && foundation.quality !== 'ready') {
      return {
        acceptanceTaskId: task.acceptanceTaskId,
        name: task.name,
        status: 'foundation_blocked',
        caseId: null,
        reason: `Foundation quality=${foundation.quality}${foundation.warnings?.length ? `：${foundation.warnings.join('；')}` : ''}`,
      };
    }

    const matching = preflight.scenarios.filter((scenario) => matchesGoal(scenario.goal, task.goalIncludes));
    if (!matching.length) {
      return {
        acceptanceTaskId: task.acceptanceTaskId,
        name: task.name,
        status: 'not_generated',
        caseId: null,
        reason: `自动生成的 Scenario 中没有找到同时包含“${task.goalIncludes.join(' / ')}”的真实任务。`,
      };
    }
    if (matching.length > 1) {
      return {
        acceptanceTaskId: task.acceptanceTaskId,
        name: task.name,
        status: 'ambiguous_scenario',
        caseId: null,
        reason: `有 ${matching.length} 个 Scenario 同时匹配该验收任务，EvalPilot 不能安全猜测应该使用哪一个。`,
      };
    }

    const scenario = matching[0]!;
    if (blockedCaseIds.has(scenario.caseId)) {
      return {
        acceptanceTaskId: task.acceptanceTaskId,
        name: task.name,
        status: 'prerequisite_blocked',
        caseId: scenario.caseId,
        reason: blockerReason(preflight, scenario.caseId),
      };
    }

    const result = resultByCaseId.get(scenario.caseId);
    if (!result) {
      return {
        acceptanceTaskId: task.acceptanceTaskId,
        name: task.name,
        status: 'not_run',
        caseId: scenario.caseId,
        reason: 'Case 已生成且未被 Preflight 阻止，但本次 evaluation 没有该 Case 的 Judge 结果。',
      };
    }
    if (result.verdict === 'pass') {
      return {
        acceptanceTaskId: task.acceptanceTaskId,
        name: task.name,
        status: 'pass',
        caseId: scenario.caseId,
        reason: result.semantic?.summary || 'Judge 已确认任务通过。',
      };
    }
    if (result.verdict === 'fail' && result.failureSource === 'product') {
      return {
        acceptanceTaskId: task.acceptanceTaskId,
        name: task.name,
        status: 'product_failure',
        caseId: scenario.caseId,
        reason: result.semantic?.summary || 'Judge 已确认 Product Failure。',
      };
    }
    return {
      acceptanceTaskId: task.acceptanceTaskId,
      name: task.name,
      status: 'evaluator_failure',
      caseId: scenario.caseId,
      reason: result.semantic?.summary || `Judge verdict=${result.verdict}，failureSource=${result.failureSource ?? 'unknown'}。`,
    };
  });

  const count = (status: AcceptanceTaskStatus) => tasks.filter((task) => task.status === status).length;
  const counts = {
    planned: tasks.length,
    passed: count('pass'),
    productFailures: count('product_failure'),
    evaluatorFailures: count('evaluator_failure'),
    prerequisiteBlocks: count('prerequisite_blocked'),
    notRun: count('not_run'),
    notGenerated: count('not_generated'),
    ambiguous: count('ambiguous_scenario'),
    foundationBlocked: count('foundation_blocked'),
  };
  const failedThresholds: string[] = [];
  if (counts.passed < manifest.thresholds.requiredPasses) failedThresholds.push(`passed ${counts.passed} < requiredPasses ${manifest.thresholds.requiredPasses}`);
  if (counts.evaluatorFailures > manifest.thresholds.maxEvaluatorFailures) failedThresholds.push(`evaluatorFailures ${counts.evaluatorFailures} > ${manifest.thresholds.maxEvaluatorFailures}`);
  if (counts.prerequisiteBlocks > manifest.thresholds.maxPrerequisiteBlocks) failedThresholds.push(`prerequisiteBlocks ${counts.prerequisiteBlocks} > ${manifest.thresholds.maxPrerequisiteBlocks}`);
  if (counts.notRun > manifest.thresholds.maxNotRun) failedThresholds.push(`notRun ${counts.notRun} > ${manifest.thresholds.maxNotRun}`);
  if (counts.notGenerated > 0) failedThresholds.push(`notGenerated ${counts.notGenerated} > 0`);
  if (counts.ambiguous > 0) failedThresholds.push(`ambiguous ${counts.ambiguous} > 0`);
  if (counts.foundationBlocked > 0) failedThresholds.push(`foundationBlocked ${counts.foundationBlocked} > 0`);

  return {
    product: manifest.product.name,
    repository: manifest.product.repository,
    commit: manifest.product.commit,
    passed: failedThresholds.length === 0,
    taskCompletionRate: counts.planned ? counts.passed / counts.planned : 0,
    counts,
    tasks,
    failedThresholds,
  };
}
