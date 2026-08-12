import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const expectedPrerequisiteSchema = z.enum(['none', 'auth', 'setup', 'file', 'human']);
const prerequisiteStepSchema = z.enum(['auth', 'setup', 'file_fixture', 'target']);

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
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['tasks'], message: 'acceptanceTaskId 必须唯一。' });
});

export type RealProductAcceptanceManifest = z.infer<typeof realProductAcceptanceManifestSchema>;

const prerequisitePlanSubsetSchema = z.object({
  caseId: z.string(),
  status: z.string(),
  executionOrder: z.array(prerequisiteStepSchema).optional(),
  reasons: z.array(z.string()).optional(),
  unresolvedBlockers: z.array(z.object({
    type: z.string(),
    summary: z.string().optional(),
    sourceValue: z.string().optional(),
  }).passthrough()).optional(),
}).passthrough();

const scenarioPreflightSchema = z.object({
  blockedCaseIds: z.array(z.string()).default([]),
  prerequisitePlans: z.array(prerequisitePlanSubsetSchema).default([]),
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
  | 'prerequisite_mismatch'
  | 'route_mismatch'
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
    prerequisiteMismatches: number;
    routeMismatches: number;
    notRun: number;
    notGenerated: number;
    ambiguous: number;
    foundationBlocked: number;
  };
  tasks: RealProductAcceptanceTaskResult[];
  failedThresholds: string[];
}

const normalize = (value: string) => value.trim().toLocaleLowerCase();
const matchesGoal = (goal: string, includes: string[]) => includes.every((token) => normalize(goal).includes(normalize(token)));
const matchesRoute = (url: string | undefined, routeIncludes: string | undefined) => !routeIncludes || Boolean(url?.includes(routeIncludes));

function blockerReason(preflight: z.infer<typeof scenarioPreflightSchema>, caseId: string): string {
  const plan = preflight.prerequisitePlans.find((item) => item.caseId === caseId);
  if (!plan) return 'Scenario Preflight 将该案例标记为 blocked。';
  const blockers = (plan.unresolvedBlockers ?? []).map((item) => [item.summary, item.sourceValue].filter(Boolean).join('：')).filter(Boolean);
  return [...(plan.reasons ?? []), ...blockers].join('；') || `Prerequisite Plan 状态为 ${plan.status}。`;
}

function prerequisiteMatches(plan: z.infer<typeof prerequisitePlanSubsetSchema> | undefined, expected: z.infer<typeof expectedPrerequisiteSchema>): boolean {
  if (!plan) return false;
  const order = new Set(plan.executionOrder ?? []);
  const blockerTypes = new Set((plan.unresolvedBlockers ?? []).map((blocker) => blocker.type));
  if (expected === 'none') {
    return !order.has('auth') && !order.has('setup') && !order.has('file_fixture') && blockerTypes.size === 0;
  }
  if (expected === 'auth') return order.has('auth') || blockerTypes.has('needs_auth');
  if (expected === 'setup') return order.has('setup') || blockerTypes.has('needs_setup');
  if (expected === 'file') return order.has('file_fixture') || blockerTypes.has('needs_test_data');
  return blockerTypes.has('needs_human_input');
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
  const planByCaseId = new Map(preflight.prerequisitePlans.map((plan) => [plan.caseId, plan]));

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

    const goalMatches = preflight.scenarios.filter((scenario) => matchesGoal(scenario.goal, task.goalIncludes));
    if (!goalMatches.length) {
      return {
        acceptanceTaskId: task.acceptanceTaskId,
        name: task.name,
        status: 'not_generated',
        caseId: null,
        reason: `自动生成的 Scenario 中没有找到同时包含“${task.goalIncludes.join(' / ')}”的真实任务。`,
      };
    }

    const routeMatches = goalMatches.filter((scenario) => matchesRoute(scenario.startingUrl, task.routeIncludes));
    if (!routeMatches.length) {
      return {
        acceptanceTaskId: task.acceptanceTaskId,
        name: task.name,
        status: 'route_mismatch',
        caseId: goalMatches.length === 1 ? goalMatches[0]!.caseId : null,
        reason: `任务 Goal 已匹配，但没有 Scenario 从预期路由“${task.routeIncludes ?? '未指定'}”进入；实际起始页：${goalMatches.map((scenario) => scenario.startingUrl ?? 'unknown').join('、')}。`,
      };
    }
    if (routeMatches.length > 1) {
      return {
        acceptanceTaskId: task.acceptanceTaskId,
        name: task.name,
        status: 'ambiguous_scenario',
        caseId: null,
        reason: `有 ${routeMatches.length} 个 Scenario 同时匹配 Goal 与路由，EvalPilot 不能安全猜测应该使用哪一个。`,
      };
    }

    const scenario = routeMatches[0]!;
    const plan = planByCaseId.get(scenario.caseId);
    if (!prerequisiteMatches(plan, task.expectedPrerequisite)) {
      return {
        acceptanceTaskId: task.acceptanceTaskId,
        name: task.name,
        status: 'prerequisite_mismatch',
        caseId: scenario.caseId,
        reason: `验收契约要求前置条件=${task.expectedPrerequisite}，但 Prerequisite Plan=${plan?.executionOrder?.join(' -> ') ?? 'missing'}；未解决 blocker=${(plan?.unresolvedBlockers ?? []).map((blocker) => blocker.type).join(', ') || 'none'}。`,
      };
    }
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
    prerequisiteMismatches: count('prerequisite_mismatch'),
    routeMismatches: count('route_mismatch'),
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
  if (counts.routeMismatches > 0) failedThresholds.push(`routeMismatches ${counts.routeMismatches} > 0`);
  if (counts.prerequisiteMismatches > 0) failedThresholds.push(`prerequisiteMismatches ${counts.prerequisiteMismatches} > 0`);

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

export async function evaluateRealProductAcceptanceFromArtifacts(input: {
  manifestPath: string;
  evaluationDirectory: string;
}): Promise<RealProductAcceptanceGateResult> {
  const [manifest, preflightText, reportText, foundationText] = await Promise.all([
    loadRealProductAcceptanceManifest(input.manifestPath),
    readFile(resolve(input.evaluationDirectory, 'scenario-preflight.json'), 'utf8'),
    readFile(resolve(input.evaluationDirectory, 'report.json'), 'utf8'),
    readFile(resolve(input.evaluationDirectory, 'foundation-quality.json'), 'utf8'),
  ]);
  return evaluateRealProductAcceptance({
    manifest,
    preflight: JSON.parse(preflightText),
    report: JSON.parse(reportText),
    foundationQuality: JSON.parse(foundationText),
  });
}
