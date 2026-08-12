import { describe, expect, it } from 'vitest';
import type { EvalCase, ProductModel, ProductTask } from '../types.js';
import { compileExecutableScenario } from '../src/scenario/scenario-compiler.js';
import { resolveScenarioSetup } from '../src/scenario/setup-resolver.js';

const now = '2026-08-12T08:00:00.000Z';
const evidence = [{ claim: 'fixture evidence', sourceType: 'repository' as const, source: 'tests/safe-setup-resolver.test.ts', status: 'verified' as const }];

function task(overrides: Partial<ProductTask> = {}): ProductTask {
  return {
    taskId: 'task-create', capabilityId: 'cap-project', name: '创建项目', goal: '创建一个测试项目', preconditions: ['项目页面已打开'], successConditions: ['项目创建成功'],
    successSignals: [{ signalId: 'signal-created', kind: 'text_visible', target: 'Created', description: '页面显示 Created', evidenceStatus: 'verified', evidence, needsHumanReview: false }],
    businessRuleIds: [], evidenceStatus: 'verified', evidence, needsHumanReview: false, ...overrides,
  };
}

function model(): ProductModel {
  const createTask = task();
  const editTask = task({ taskId: 'task-edit', name: '编辑项目', goal: '编辑已有测试项目', preconditions: ['已有一个已创建的项目'], successConditions: ['项目编辑成功'], successSignals: [{ signalId: 'signal-edited', kind: 'text_visible', target: 'Updated', description: '页面显示 Updated', evidenceStatus: 'verified', evidence, needsHumanReview: false }] });
  return {
    projectId: 'project-demo', version: 1, generatedAt: now, productName: 'Demo', productType: 'Web App', targetUsers: [],
    capabilities: [{ capabilityId: 'cap-project', name: '项目', description: '创建和编辑项目', routes: ['/projects'], entryPoints: ['/projects'], userGoals: ['管理项目'], supportedTasks: ['task-create', 'task-edit'], importance: 'critical', evidenceStatus: 'verified', evidence, needsHumanReview: false }],
    userTasks: [createTask, editTask], objectLifecycles: [],
    crossPageJourneys: [{ journeyId: 'journey-project', name: '项目生命周期', taskIds: ['task-create', 'task-edit'], routes: ['/projects'], successConditions: ['项目可创建并编辑'], evidenceStatus: 'verified', evidence, needsHumanReview: false }],
    businessRules: [], knownRisks: [], unknowns: [], evidence,
  };
}

function evalCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    caseId: 'case-edit', projectId: 'project-demo', setType: 'baseline', status: 'stable', origin: { type: 'human', note: 'safe setup fixture' }, capabilityId: 'cap-project', taskId: 'task-edit', title: '编辑已有项目', hypothesis: '用户可以编辑已有项目', persona: { personaId: 'persona', name: '测试用户', behaviorPolicy: ['只执行安全操作'] }, goal: '编辑已有测试项目', knownInformation: {}, preconditions: ['已有一个已创建的项目'],
    oracle: { expectedOutcome: ['项目编辑成功'], mustObserve: ['Updated'], mustNotObserve: [], businessRules: [], semanticRubric: [], deterministicAssertions: [{ assertionId: 'assert-edited', type: 'text_visible', target: 'Updated', expected: true, negated: false }], inconclusiveWhen: [] },
    coverageDimensions: [], riskLevel: 'P1', generationReason: 'fixture', version: 1, stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 0, lastExecutedAt: null }, regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: now, updatedAt: now, ...overrides,
  };
}

function resolution(productModel = model(), caseValue = evalCase(), targetUrl = 'http://127.0.0.1:3000') {
  const scenario = compileExecutableScenario({ evalCase: caseValue, productModel, targetUrl, generatedAt: now });
  return { scenario, result: resolveScenarioSetup({ scenario, evalCase: caseValue, productModel, targetUrl, generatedAt: now }) };
}

describe('Safe Setup Resolver', () => {
  it('uses one explicit verified local journey predecessor as ephemeral setup', () => {
    const { scenario, result } = resolution();
    expect(scenario.readiness).toBe('needs_setup');
    expect(result.status).toBe('auto_setup');
    expect(result.plan).toMatchObject({ targetCaseId: 'case-edit', targetTaskId: 'task-edit', setupTaskId: 'task-create' });
    expect(result.plan?.setupScenario.readiness).toBe('ready');
    expect(result.plan?.setupCase.oracle.deterministicAssertions).toEqual([expect.objectContaining({ type: 'text_visible', target: 'Created' })]);
  });

  it('does not turn authentication into automatic setup', () => {
    const productModel = model();
    productModel.userTasks[1] = task({ taskId: 'task-edit', name: '编辑项目', goal: '编辑已有项目', preconditions: ['用户已登录测试账号'] });
    const { scenario, result } = resolution(productModel, evalCase({ preconditions: ['用户已登录测试账号'] }));
    expect(scenario.readiness).toBe('needs_auth');
    expect(result.status).toBe('blocked');
    expect(result.plan).toBeNull();
  });

  it('does not auto setup a remote target', () => {
    const { result } = resolution(model(), evalCase(), 'https://example.com');
    expect(result.status).toBe('blocked');
    expect(result.reason).toContain('localhost');
  });

  it('does not guess which dependency to run when a journey has multiple prior tasks', () => {
    const productModel = model();
    const prepareTask = task({ taskId: 'task-prepare', name: '准备空间', goal: '准备测试空间' });
    productModel.userTasks = [prepareTask, ...productModel.userTasks];
    productModel.capabilities[0]!.supportedTasks = ['task-prepare', 'task-create', 'task-edit'];
    productModel.crossPageJourneys = [{ ...productModel.crossPageJourneys![0]!, taskIds: ['task-prepare', 'task-create', 'task-edit'] }];
    const { result } = resolution(productModel);
    expect(result.status).toBe('blocked');
    expect(result.reason).toContain('多个步骤');
  });

  it('does not auto setup a predecessor that requires human review', () => {
    const productModel = model();
    productModel.userTasks[0] = task({ needsHumanReview: true });
    const { result } = resolution(productModel);
    expect(result.status).toBe('blocked');
    expect(result.plan).toBeNull();
  });

  it('requires a verified deterministic visible or URL signal', () => {
    const productModel = model();
    productModel.userTasks[0] = task({ successSignals: [{ signalId: 'signal-semantic', kind: 'semantic', target: '项目存在', description: '状态需要语义判断', evidenceStatus: 'inferred', evidence, needsHumanReview: false }] });
    const { result } = resolution(productModel);
    expect(result.status).toBe('blocked');
    expect(result.plan).toBeNull();
  });
});
