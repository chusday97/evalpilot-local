import type { EvalCase, ProductModel, ProductTask } from '../../types.js';

export type ScenarioReadiness =
  | 'ready'
  | 'needs_test_data'
  | 'needs_auth'
  | 'needs_setup'
  | 'needs_human_input'
  | 'unsupported';

export type ScenarioBlockerType = Exclude<ScenarioReadiness, 'ready'>;

export interface ScenarioBlocker {
  blockerId: string;
  type: ScenarioBlockerType;
  summary: string;
  source: 'precondition' | 'product_model' | 'case';
  sourceValue: string;
}

export interface ScenarioPreconditionCheck {
  text: string;
  status: 'satisfied' | 'unresolved';
  reason: string;
}

export interface ExecutableScenario {
  scenarioId: string;
  projectId: string;
  caseId: string;
  capabilityId: string;
  taskId: string | null;
  goal: string;
  startingUrl: string;
  readiness: ScenarioReadiness;
  blockers: ScenarioBlocker[];
  preconditions: ScenarioPreconditionCheck[];
  knownInformationKeys: string[];
  generatedAt: string;
}

const trivialPreconditionPatterns = [
  /(?:page|app|application|site|fixture|project|service|dev server|server).*(?:open|opened|available|running|reachable|started)/i,
  /(?:页面|网页|应用|站点|测试页).*(?:已打开|可访问|已启动|运行中)/,
  /(?:项目|服务).*(?:已启动|可访问|运行中)/,
];

const authPatterns = [
  /\b(?:logged?\s*in|signed?\s*in|authenticated|auth session|test account)\b/i,
  /(?:已登录|登录态|测试账号|认证状态|用户会话)/,
];

const testDataPatterns = [
  /\b(?:test file|fixture file|uploaded file|sample file|seed data|test data)\b/i,
  /(?:测试文件|样例文件|待上传文件|测试数据|样例数据|种子数据)/,
];

const humanInputPatterns = [
  /\b(?:human confirmation|business decision|business rule|real expectation|manual approval)\b/i,
  /(?:人工确认|业务判断|业务规则|真实期望|人工审批|需要确认)/,
];

const setupPatterns = [
  /\b(?:existing|already created|previous|pre-existing|saved)\s+(?:project|item|profile|record|draft|object|data)\b/i,
  /\b(?:draft|record|project|item|profile|object)\s+(?:exists|already exists|has been created|has been saved)\b/i,
  /(?:已有|已创建|预先存在|之前创建|已保存).*(?:草稿|记录|项目|对象|资料|数据)?/,
];

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
}

function knownInformationSatisfies(precondition: string, knownInformation: Record<string, unknown>): boolean {
  const condition = normalized(precondition);
  return Object.entries(knownInformation).some(([key, value]) => {
    if (value === null || value === undefined || typeof value === 'object') return false;
    const normalizedKey = normalized(key);
    return normalizedKey.length >= 3 && condition.includes(normalizedKey);
  });
}

function preconditionBlocker(caseId: string, index: number, text: string): ScenarioBlocker | null {
  if (matchesAny(text, authPatterns)) {
    return { blockerId: `${caseId}-precondition-${index + 1}`, type: 'needs_auth', summary: '这个任务需要可复用的测试登录态，当前还没有安全的认证 Fixture。', source: 'precondition', sourceValue: text };
  }
  if (matchesAny(text, testDataPatterns)) {
    return { blockerId: `${caseId}-precondition-${index + 1}`, type: 'needs_test_data', summary: '这个任务依赖测试文件或测试数据，当前 Scenario 还没有对应 Fixture。', source: 'precondition', sourceValue: text };
  }
  if (matchesAny(text, humanInputPatterns)) {
    return { blockerId: `${caseId}-precondition-${index + 1}`, type: 'needs_human_input', summary: '这个任务依赖尚未确认的业务条件，不能由评测器自行猜测。', source: 'precondition', sourceValue: text };
  }
  if (matchesAny(text, setupPatterns)) {
    return { blockerId: `${caseId}-precondition-${index + 1}`, type: 'needs_setup', summary: '这个任务依赖已有对象或历史状态，需要先执行 Setup。', source: 'precondition', sourceValue: text };
  }
  return { blockerId: `${caseId}-precondition-${index + 1}`, type: 'needs_setup', summary: '这个前置条件尚未被 Scenario Setup 明确满足，因此暂不启动 Agent。', source: 'precondition', sourceValue: text };
}

function readinessFrom(blockers: ScenarioBlocker[]): ScenarioReadiness {
  if (!blockers.length) return 'ready';
  const order: ScenarioBlockerType[] = ['unsupported', 'needs_auth', 'needs_test_data', 'needs_human_input', 'needs_setup'];
  return order.find((type) => blockers.some((blocker) => blocker.type === type)) ?? 'needs_setup';
}

function taskFor(evalCase: EvalCase, model: ProductModel): ProductTask | null {
  if (!evalCase.taskId) return null;
  return model.userTasks.find((task) => task.taskId === evalCase.taskId) ?? null;
}

function startingUrlFor(evalCase: EvalCase, model: ProductModel, targetUrl: string): { url: string; blocker: ScenarioBlocker | null } {
  const capability = model.capabilities.find((item) => item.capabilityId === evalCase.capabilityId);
  const entry = capability?.entryPoints[0] ?? targetUrl;
  try {
    return { url: new URL(entry, targetUrl).toString(), blocker: null };
  } catch {
    return {
      url: targetUrl,
      blocker: {
        blockerId: `${evalCase.caseId}-starting-url`,
        type: 'unsupported',
        summary: '这个案例没有可解析的安全起始页面。',
        source: 'product_model',
        sourceValue: entry,
      },
    };
  }
}

export function compileExecutableScenario(input: {
  evalCase: EvalCase;
  productModel: ProductModel;
  targetUrl: string;
  generatedAt?: string;
}): ExecutableScenario {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const blockers: ScenarioBlocker[] = [];
  const resolvedTask = taskFor(input.evalCase, input.productModel);
  if (input.evalCase.taskId && !resolvedTask) {
    blockers.push({
      blockerId: `${input.evalCase.caseId}-missing-task`,
      type: 'unsupported',
      summary: '这个案例引用的 Product Task 已不存在，不能安全执行。',
      source: 'product_model',
      sourceValue: input.evalCase.taskId,
    });
  }

  const start = startingUrlFor(input.evalCase, input.productModel, input.targetUrl);
  if (start.blocker) blockers.push(start.blocker);

  const sourcePreconditions = [...new Set([
    ...input.evalCase.preconditions,
    ...(resolvedTask?.preconditions ?? []),
  ].map((item) => item.trim()).filter(Boolean))];

  const preconditions = sourcePreconditions.map((text, index): ScenarioPreconditionCheck => {
    if (matchesAny(text, trivialPreconditionPatterns)) {
      return { text, status: 'satisfied', reason: '该条件由项目 Readiness / 起始页面检查负责。' };
    }
    if (knownInformationSatisfies(text, input.evalCase.knownInformation)) {
      return { text, status: 'satisfied', reason: '案例已提供与该条件关联的已知测试信息。' };
    }
    const blocker = preconditionBlocker(input.evalCase.caseId, index, text);
    if (blocker) blockers.push(blocker);
    return { text, status: 'unresolved', reason: blocker?.summary ?? '前置条件尚未解析。' };
  });

  return {
    scenarioId: `scenario-${input.evalCase.caseId}`,
    projectId: input.evalCase.projectId,
    caseId: input.evalCase.caseId,
    capabilityId: input.evalCase.capabilityId,
    taskId: input.evalCase.taskId,
    goal: input.evalCase.goal,
    startingUrl: start.url,
    readiness: readinessFrom(blockers),
    blockers,
    preconditions,
    knownInformationKeys: Object.keys(input.evalCase.knownInformation).sort(),
    generatedAt,
  };
}

export function compileExecutableScenarios(input: {
  cases: EvalCase[];
  productModel: ProductModel;
  targetUrl: string;
  generatedAt?: string;
}): ExecutableScenario[] {
  return input.cases.map((evalCase) => compileExecutableScenario({
    evalCase,
    productModel: input.productModel,
    targetUrl: input.targetUrl,
    generatedAt: input.generatedAt,
  }));
}

export function scenarioBlockerSummary(scenarios: ExecutableScenario[]): string {
  const blocked = scenarios.filter((scenario) => scenario.readiness !== 'ready');
  if (!blocked.length) return '';
  return blocked.map((scenario) => {
    const details = scenario.blockers.map((blocker) => blocker.sourceValue ? `${blocker.summary}（${blocker.sourceValue}）` : blocker.summary).join('；');
    return `${scenario.caseId}: ${details}`;
  }).join(' | ');
}
