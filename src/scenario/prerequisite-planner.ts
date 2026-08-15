import type { EvalCase, ProductModel } from '../../types.js';
import { resolveAuthSessionFixture, type AuthSessionFixture } from './auth-session-fixture.js';
import { resolveSyntheticFileFixtures, type SyntheticFileFixturePlan } from './file-fixture-resolver.js';
import { projectScenarioBlockers, type ExecutableScenario, type ScenarioBlocker, type ScenarioBlockerType } from './scenario-compiler.js';
import { resolveScenarioSetupChain, type AutoSetupPlan } from './setup-resolver.js';

export type PrerequisiteStep = 'auth' | 'setup' | 'file_fixture' | 'target';
export type ChainAwareSetupPlan = AutoSetupPlan & { chainSteps?: AutoSetupPlan[] };

export interface PrerequisitePlan {
  caseId: string;
  status: 'not_required' | 'ready' | 'blocked';
  executionOrder: PrerequisiteStep[];
  authFixture: AuthSessionFixture | null;
  setupPlan: ChainAwareSetupPlan | null;
  setupPlans: AutoSetupPlan[];
  fileFixturePlan: SyntheticFileFixturePlan | null;
  unresolvedBlockers: ScenarioBlocker[];
  reasons: string[];
}

export interface PrerequisitePlanSummary {
  caseId: string;
  status: PrerequisitePlan['status'];
  executionOrder: PrerequisiteStep[];
  unresolvedBlockers: ScenarioBlocker[];
  reasons: string[];
  auth: null | { source: AuthSessionFixture['source']; targetOrigin: string; cookieCount: number; originCount: number };
  setup: null | { setupId: string; setupTaskId: string; setupScenarioId: string };
  setupChain: Array<{ setupId: string; setupTaskId: string; setupScenarioId: string }>;
  fileFixtures: Array<{ fixtureId: string; kind: string; filename: string; mimeType: string }>;
}

const plannerTypes: ScenarioBlockerType[] = ['needs_auth', 'needs_setup', 'needs_test_data'];
const nonAutomatableTypes: ScenarioBlockerType[] = ['unsupported', 'needs_human_input'];

function blockersOf(scenario: ExecutableScenario, type: ScenarioBlockerType): ScenarioBlocker[] {
  return scenario.blockers.filter((blocker) => blocker.type === type);
}

function uniqueBlockers(blockers: ScenarioBlocker[]): ScenarioBlocker[] {
  return [...new Map(blockers.map((blocker) => [blocker.blockerId, blocker])).values()];
}

function chainAwareSetupPlan(caseId: string, setupPlans: AutoSetupPlan[]): ChainAwareSetupPlan | null {
  if (!setupPlans.length) return null;
  if (setupPlans.length === 1) return setupPlans[0]!;
  const finalStep = setupPlans.at(-1)!;
  return Object.assign({}, finalStep, {
    setupId: `setup-chain-${caseId}`,
    reason: `按顺序执行 ${setupPlans.length} 个 verified Setup 步骤。`,
    chainSteps: setupPlans,
  });
}

export function orderCasesBySetupDependencies(cases: EvalCase[], plans: PrerequisitePlan[]): EvalCase[] {
  if (cases.length <= 1) return [...cases];

  const originalIndex = new Map(cases.map((evalCase, index) => [evalCase.caseId, index]));
  const caseByTaskId = new Map<string, EvalCase>();
  for (const evalCase of cases) {
    if (evalCase.taskId && !caseByTaskId.has(evalCase.taskId)) caseByTaskId.set(evalCase.taskId, evalCase);
  }
  const planByCaseId = new Map(plans.map((plan) => [plan.caseId, plan]));
  const dependents = new Map<string, Set<string>>();
  const indegree = new Map(cases.map((evalCase) => [evalCase.caseId, 0]));

  for (const evalCase of cases) {
    const plan = planByCaseId.get(evalCase.caseId);
    if (!plan) continue;
    const dependencyCaseIds = new Set<string>();
    for (const setup of plan.setupPlans) {
      const dependency = caseByTaskId.get(setup.setupTaskId);
      if (!dependency || dependency.caseId === evalCase.caseId) continue;
      dependencyCaseIds.add(dependency.caseId);
    }
    for (const dependencyCaseId of dependencyCaseIds) {
      const children = dependents.get(dependencyCaseId) ?? new Set<string>();
      children.add(evalCase.caseId);
      dependents.set(dependencyCaseId, children);
      indegree.set(evalCase.caseId, (indegree.get(evalCase.caseId) ?? 0) + 1);
    }
  }

  const byOriginalOrder = (left: string, right: string) => (originalIndex.get(left) ?? Number.MAX_SAFE_INTEGER) - (originalIndex.get(right) ?? Number.MAX_SAFE_INTEGER);
  const ready = cases.filter((evalCase) => (indegree.get(evalCase.caseId) ?? 0) === 0).map((evalCase) => evalCase.caseId).sort(byOriginalOrder);
  const emitted = new Set<string>();
  const orderedIds: string[] = [];

  while (ready.length) {
    const caseId = ready.shift()!;
    if (emitted.has(caseId)) continue;
    emitted.add(caseId);
    orderedIds.push(caseId);
    const children = [...(dependents.get(caseId) ?? [])].sort(byOriginalOrder);
    for (const child of children) {
      const remaining = Math.max(0, (indegree.get(child) ?? 0) - 1);
      indegree.set(child, remaining);
      if (remaining === 0) {
        ready.push(child);
        ready.sort(byOriginalOrder);
      }
    }
  }

  // A cycle should already have been rejected by the Setup resolver. Preserve the original
  // relative order for any unresolved remainder rather than inventing a dependency order.
  for (const evalCase of cases) {
    if (!emitted.has(evalCase.caseId)) orderedIds.push(evalCase.caseId);
  }

  const caseById = new Map(cases.map((evalCase) => [evalCase.caseId, evalCase]));
  return orderedIds.map((caseId) => caseById.get(caseId)!).filter(Boolean);
}

export async function planScenarioPrerequisites(input: {
  scenario: ExecutableScenario;
  evalCase: EvalCase;
  productModel: ProductModel;
  targetUrl: string;
  projectRoot: string;
  authStorageStatePath?: string | null;
  generatedAt?: string;
}): Promise<PrerequisitePlan> {
  if (input.scenario.readiness === 'ready') {
    return { caseId: input.evalCase.caseId, status: 'not_required', executionOrder: ['target'], authFixture: null, setupPlan: null, setupPlans: [], fileFixturePlan: null, unresolvedBlockers: [], reasons: ['Scenario 已具备执行条件。'] };
  }

  const hardBlockers = uniqueBlockers(input.scenario.blockers.filter((blocker) => nonAutomatableTypes.includes(blocker.type)));
  if (hardBlockers.length) {
    return {
      caseId: input.evalCase.caseId,
      status: 'blocked',
      executionOrder: ['target'],
      authFixture: null,
      setupPlan: null,
      setupPlans: [],
      fileFixturePlan: null,
      unresolvedBlockers: hardBlockers,
      reasons: ['Scenario 包含需要人工确认或当前不支持的前置条件，Planner 在读取任何本地 Fixture 前停止。'],
    };
  }

  const reasons: string[] = [];
  const unresolved: ScenarioBlocker[] = [];
  let authFixture: AuthSessionFixture | null = null;
  let setupPlans: AutoSetupPlan[] = [];
  let fileFixturePlan: SyntheticFileFixturePlan | null = null;

  const authBlockers = blockersOf(input.scenario, 'needs_auth');
  if (authBlockers.length) {
    const authScenario = projectScenarioBlockers(input.scenario, ['needs_auth']);
    const auth = await resolveAuthSessionFixture({ scenario: authScenario, targetUrl: input.targetUrl, projectRoot: input.projectRoot, storageStatePath: input.authStorageStatePath });
    reasons.push(`Auth: ${auth.reason}`);
    if (auth.status === 'ready' && auth.fixture) authFixture = auth.fixture;
    else unresolved.push(...authBlockers);
  }

  const fileBlockers = blockersOf(input.scenario, 'needs_test_data');
  if (fileBlockers.length) {
    const fileScenario = projectScenarioBlockers(input.scenario, ['needs_test_data']);
    const file = resolveSyntheticFileFixtures({ scenario: fileScenario, targetUrl: input.targetUrl });
    reasons.push(`File: ${file.reason}`);
    if (file.status === 'ready' && file.plan) fileFixturePlan = file.plan;
    else unresolved.push(...fileBlockers);
  }

  const setupBlockers = blockersOf(input.scenario, 'needs_setup');
  if (setupBlockers.length) {
    const setupScenario = projectScenarioBlockers(input.scenario, ['needs_setup']);
    const setup = resolveScenarioSetupChain({
      scenario: setupScenario,
      evalCase: input.evalCase,
      productModel: input.productModel,
      targetUrl: input.targetUrl,
      generatedAt: input.generatedAt,
      satisfiedBlockerTypes: authFixture ? ['needs_auth'] : [],
    });
    reasons.push(`Setup: ${setup.reason}`);
    if (setup.status === 'auto_setup' && setup.plan) setupPlans = setup.plan.steps;
    else unresolved.push(...setupBlockers);
  }

  const unhandledAutomatable = input.scenario.blockers.filter((blocker) => !plannerTypes.includes(blocker.type) && !nonAutomatableTypes.includes(blocker.type));
  unresolved.push(...unhandledAutomatable);
  const unresolvedBlockers = uniqueBlockers(unresolved);
  const setupPlan = chainAwareSetupPlan(input.evalCase.caseId, setupPlans);
  const executionOrder: PrerequisiteStep[] = [
    ...(authFixture ? ['auth' as const] : []),
    ...setupPlans.map(() => 'setup' as const),
    ...(fileFixturePlan ? ['file_fixture' as const] : []),
    'target',
  ];
  return {
    caseId: input.evalCase.caseId,
    status: unresolvedBlockers.length ? 'blocked' : 'ready',
    executionOrder,
    authFixture,
    setupPlan,
    setupPlans,
    fileFixturePlan,
    unresolvedBlockers,
    reasons,
  };
}

export async function planScenarioPrerequisiteSet(input: {
  scenarios: ExecutableScenario[];
  cases: EvalCase[];
  productModel: ProductModel;
  targetUrl: string;
  projectRoot: string;
  authStorageStatePath?: string | null;
  generatedAt?: string;
}): Promise<PrerequisitePlan[]> {
  const caseById = new Map(input.cases.map((item) => [item.caseId, item]));
  const plans = await Promise.all(input.scenarios.map(async (scenario) => {
    const evalCase = caseById.get(scenario.caseId);
    if (!evalCase) return {
      caseId: scenario.caseId,
      status: 'blocked' as const,
      executionOrder: ['target'] as PrerequisiteStep[],
      authFixture: null,
      setupPlan: null,
      setupPlans: [],
      fileFixturePlan: null,
      unresolvedBlockers: scenario.blockers,
      reasons: ['Scenario 对应的 Eval Case 已不存在。'],
    };
    return planScenarioPrerequisites({ scenario, evalCase, productModel: input.productModel, targetUrl: input.targetUrl, projectRoot: input.projectRoot, authStorageStatePath: input.authStorageStatePath, generatedAt: input.generatedAt });
  }));

  // The orchestrator receives this same mutable selection array. Normalize it here after the
  // complete Setup graph is known so prerequisite target cases run first and their verified
  // checkpoints can satisfy downstream cases instead of rerunning the same Setup work.
  const orderedCases = orderCasesBySetupDependencies(input.cases, plans);
  input.cases.splice(0, input.cases.length, ...orderedCases);
  return plans;
}

export function summarizePrerequisitePlan(plan: PrerequisitePlan): PrerequisitePlanSummary {
  const fixtureMaterializationFailed = plan.reasons.some((reason) => reason.includes('合成 Fixture 无法安全写入'));
  const summarizeSetup = (setup: AutoSetupPlan) => ({ setupId: setup.setupId, setupTaskId: setup.setupTaskId, setupScenarioId: setup.setupScenario.scenarioId });
  return {
    caseId: plan.caseId,
    status: plan.status,
    executionOrder: plan.executionOrder,
    unresolvedBlockers: plan.unresolvedBlockers,
    reasons: plan.reasons,
    auth: plan.authFixture ? { source: plan.authFixture.source, targetOrigin: plan.authFixture.targetOrigin, cookieCount: plan.authFixture.cookieCount, originCount: plan.authFixture.originCount } : null,
    setup: plan.setupPlans.length === 1 && plan.setupPlan ? summarizeSetup(plan.setupPlan) : null,
    setupChain: plan.setupPlans.map(summarizeSetup),
    fileFixtures: fixtureMaterializationFailed ? [] : plan.fileFixturePlan?.fixtures.map((fixture) => ({ fixtureId: fixture.fixtureId, kind: fixture.kind, filename: fixture.filename, mimeType: fixture.mimeType })) ?? [],
  };
}
