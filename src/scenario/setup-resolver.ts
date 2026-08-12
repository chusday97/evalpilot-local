import type { EvalCase, ProductModel, ProductTask } from '../../types.js';
import { buildDeterministicOracle } from '../eval-set/oracle-builder.js';
import { compileExecutableScenario, type ExecutableScenario, type ScenarioBlocker } from './scenario-compiler.js';

export interface AutoSetupPlan {
  setupId: string;
  targetCaseId: string;
  targetTaskId: string;
  setupTaskId: string;
  setupCase: EvalCase;
  setupScenario: ExecutableScenario;
  reason: string;
}

export interface ScenarioSetupResolution {
  caseId: string;
  status: 'not_required' | 'auto_setup' | 'blocked';
  plan: AutoSetupPlan | null;
  blockers: ScenarioBlocker[];
  reason: string;
}

const irreversibleSetupPatterns = [
  /\b(?:delete|remove|destroy|purchase|buy|pay|charge|transfer|refund|publish|send|invite|deploy|merge|cancel subscription)\b/i,
  /(?:删除|移除|销毁|购买|支付|扣款|转账|退款|发布|发送|邀请|部署|合并|取消订阅)/,
];

function isLocalTarget(targetUrl: string): boolean {
  try {
    const hostname = new URL(targetUrl).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

function taskIsSafeForAutomaticSetup(task: ProductTask): boolean {
  if (task.needsHumanReview || task.evidenceStatus !== 'verified') return false;
  const text = [task.name, task.goal, ...task.preconditions, ...task.successConditions].join(' ');
  if (irreversibleSetupPatterns.some((pattern) => pattern.test(text))) return false;
  const signals = task.successSignals ?? [];
  return signals.some((signal) =>
    !signal.needsHumanReview
    && signal.evidenceStatus === 'verified'
    && (signal.kind === 'text_visible' || signal.kind === 'url_matches'),
  );
}

function setupTaskFor(targetCase: EvalCase, model: ProductModel): { task: ProductTask | null; reason: string } {
  if (!targetCase.taskId) return { task: null, reason: '目标 Case 没有 Product Task，无法建立明确 Setup 依赖。' };
  const journeys = (model.crossPageJourneys ?? []).filter((journey) => journey.taskIds.includes(targetCase.taskId!));
  if (journeys.length !== 1) return { task: null, reason: journeys.length ? '目标任务存在多个 Journey，自动 Setup 依赖不唯一。' : 'Product Model 没有声明该任务的 Journey 前置步骤。' };
  const targetIndex = journeys[0]!.taskIds.indexOf(targetCase.taskId);
  const priorTaskIds = journeys[0]!.taskIds.slice(0, targetIndex);
  if (priorTaskIds.length !== 1) return { task: null, reason: priorTaskIds.length ? '目标任务之前存在多个步骤，第一版 Setup Resolver 不会猜测哪些步骤可以跳过。' : '目标任务在 Journey 中没有明确前置任务。' };
  const task = model.userTasks.find((item) => item.taskId === priorTaskIds[0]) ?? null;
  if (!task) return { task: null, reason: 'Journey 引用的前置 Product Task 已不存在。' };
  if (!taskIsSafeForAutomaticSetup(task)) return { task: null, reason: '前置任务缺少 verified 可观察成功信号，或包含需要人工确认/高风险操作，不能自动 Setup。' };
  return { task, reason: `使用 Journey “${journeys[0]!.name}”中唯一的前置任务“${task.name}”准备测试状态。` };
}

function setupCaseFor(targetCase: EvalCase, setupTask: ProductTask, model: ProductModel, generatedAt: string): EvalCase {
  const built = buildDeterministicOracle(model, setupTask);
  const allowedAssertionIds = new Set((setupTask.successSignals ?? [])
    .filter((signal) => signal.evidenceStatus === 'verified' && !signal.needsHumanReview && (signal.kind === 'text_visible' || signal.kind === 'url_matches'))
    .map((signal) => `assert-${signal.signalId}`));
  const oracle = {
    ...built.oracle,
    deterministicAssertions: built.oracle.deterministicAssertions.filter((assertion) => allowedAssertionIds.has(assertion.assertionId)),
  };
  return {
    caseId: `setup-${targetCase.caseId}-${setupTask.taskId}`,
    projectId: targetCase.projectId,
    setType: 'exploratory',
    status: 'stable',
    origin: { type: 'human', note: `Ephemeral Setup for ${targetCase.caseId}` },
    capabilityId: setupTask.capabilityId,
    taskId: setupTask.taskId,
    title: `Setup：${setupTask.name}`,
    hypothesis: `先完成“${setupTask.name}”可为目标案例建立可验证的本地测试状态`,
    persona: targetCase.persona,
    goal: setupTask.goal,
    knownInformation: targetCase.knownInformation,
    preconditions: setupTask.preconditions,
    oracle,
    coverageDimensions: [],
    riskLevel: targetCase.riskLevel,
    generationReason: `Safe Setup Resolver for ${targetCase.caseId}`,
    version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 0, lastExecutedAt: null },
    regressionMetadata: null,
    retirementReason: null,
    needsHumanReview: false,
    createdAt: generatedAt,
    updatedAt: generatedAt,
  };
}

export function resolveScenarioSetup(input: {
  scenario: ExecutableScenario;
  evalCase: EvalCase;
  productModel: ProductModel;
  targetUrl: string;
  generatedAt?: string;
}): ScenarioSetupResolution {
  if (input.scenario.readiness === 'ready') return { caseId: input.evalCase.caseId, status: 'not_required', plan: null, blockers: [], reason: 'Scenario 已具备执行条件。' };
  if (!input.scenario.blockers.length || input.scenario.blockers.some((blocker) => blocker.type !== 'needs_setup')) {
    return { caseId: input.evalCase.caseId, status: 'blocked', plan: null, blockers: input.scenario.blockers, reason: 'Scenario 包含认证、测试文件、人工条件或不支持项，不能由自动 Setup 处理。' };
  }
  if (!isLocalTarget(input.targetUrl)) {
    return { caseId: input.evalCase.caseId, status: 'blocked', plan: null, blockers: input.scenario.blockers, reason: '自动 Setup 第一版只允许 localhost / loopback 测试目标，避免修改远程真实数据。' };
  }
  const resolved = setupTaskFor(input.evalCase, input.productModel);
  if (!resolved.task) return { caseId: input.evalCase.caseId, status: 'blocked', plan: null, blockers: input.scenario.blockers, reason: resolved.reason };
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const setupCase = setupCaseFor(input.evalCase, resolved.task, input.productModel, generatedAt);
  if (!setupCase.oracle.deterministicAssertions.length) {
    return { caseId: input.evalCase.caseId, status: 'blocked', plan: null, blockers: input.scenario.blockers, reason: '前置任务没有足够的 verified 确定性成功信号，不能证明 Setup 已完成。' };
  }
  const setupScenario = compileExecutableScenario({ evalCase: setupCase, productModel: input.productModel, targetUrl: input.targetUrl, generatedAt });
  if (setupScenario.readiness !== 'ready') {
    return { caseId: input.evalCase.caseId, status: 'blocked', plan: null, blockers: input.scenario.blockers, reason: `前置任务本身也不具备安全执行条件：${setupScenario.blockers.map((item) => item.summary).join('；')}` };
  }
  return {
    caseId: input.evalCase.caseId,
    status: 'auto_setup',
    blockers: [],
    reason: resolved.reason,
    plan: {
      setupId: `setup-${input.evalCase.caseId}`,
      targetCaseId: input.evalCase.caseId,
      targetTaskId: input.evalCase.taskId!,
      setupTaskId: resolved.task.taskId,
      setupCase,
      setupScenario,
      reason: resolved.reason,
    },
  };
}

export function resolveScenarioSetups(input: {
  scenarios: ExecutableScenario[];
  cases: EvalCase[];
  productModel: ProductModel;
  targetUrl: string;
  generatedAt?: string;
}): ScenarioSetupResolution[] {
  const caseById = new Map(input.cases.map((item) => [item.caseId, item]));
  return input.scenarios.map((scenario) => {
    const evalCase = caseById.get(scenario.caseId);
    if (!evalCase) return { caseId: scenario.caseId, status: 'blocked', plan: null, blockers: scenario.blockers, reason: 'Scenario 对应的 Eval Case 已不存在。' };
    return resolveScenarioSetup({ scenario, evalCase, productModel: input.productModel, targetUrl: input.targetUrl, generatedAt: input.generatedAt });
  });
}
