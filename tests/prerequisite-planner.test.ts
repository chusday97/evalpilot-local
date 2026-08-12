import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EvalCase, ProductModel, ProductTask } from '../types.js';
import { planScenarioPrerequisites, summarizePrerequisitePlan } from '../src/scenario/prerequisite-planner.js';
import { compileExecutableScenario } from '../src/scenario/scenario-compiler.js';

const now = '2026-08-12T10:00:00.000Z';
const evidence = [{ claim: 'planner fixture', sourceType: 'repository' as const, source: 'tests/prerequisite-planner.test.ts', status: 'verified' as const }];

function task(overrides: Partial<ProductTask> = {}): ProductTask {
  return {
    taskId: 'task-create', capabilityId: 'cap-project', name: '创建项目', goal: '创建一个测试项目', preconditions: ['用户已登录测试账号'], successConditions: ['项目创建成功'],
    successSignals: [{ signalId: 'signal-created', kind: 'text_visible', target: 'Created', description: '页面显示 Created', evidenceStatus: 'verified', evidence, needsHumanReview: false }],
    businessRuleIds: [], evidenceStatus: 'verified', evidence, needsHumanReview: false, ...overrides,
  };
}

function model(): ProductModel {
  const createTask = task();
  const importTask = task({
    taskId: 'task-import', name: '导入项目数据', goal: '向已有项目导入测试 CSV',
    preconditions: ['用户已登录测试账号', '已有一个已创建的项目', '测试 CSV 文件已准备'], successConditions: ['导入完成'],
    successSignals: [{ signalId: 'signal-imported', kind: 'text_visible', target: 'Imported', description: '页面显示 Imported', evidenceStatus: 'verified', evidence, needsHumanReview: false }],
  });
  return {
    projectId: 'project-prereq', version: 1, generatedAt: now, productName: 'Prerequisite Fixture', productType: 'Web App', targetUsers: [],
    capabilities: [{ capabilityId: 'cap-project', name: '项目', description: '项目管理', routes: ['/projects'], entryPoints: ['/projects'], userGoals: ['管理项目'], supportedTasks: ['task-create', 'task-import'], importance: 'critical', evidenceStatus: 'verified', evidence, needsHumanReview: false }],
    userTasks: [createTask, importTask], objectLifecycles: [],
    crossPageJourneys: [{ journeyId: 'journey-import', name: '创建后导入', taskIds: ['task-create', 'task-import'], routes: ['/projects'], successConditions: ['创建项目后导入数据'], evidenceStatus: 'verified', evidence, needsHumanReview: false }],
    businessRules: [], knownRisks: [], unknowns: [], evidence,
  };
}

function evalCase(extraPreconditions: string[] = []): EvalCase {
  return {
    caseId: 'case-import', projectId: 'project-prereq', setType: 'baseline', status: 'stable', origin: { type: 'human', note: 'prerequisite planner fixture' }, capabilityId: 'cap-project', taskId: 'task-import', title: '登录后向已有项目导入 CSV', hypothesis: '具备前置条件时可导入', persona: { personaId: 'persona', name: '测试用户', behaviorPolicy: ['只执行安全操作'] }, goal: '向已有项目导入测试 CSV', knownInformation: {},
    preconditions: ['用户已登录测试账号', '已有一个已创建的项目', '测试 CSV 文件已准备', ...extraPreconditions],
    oracle: { expectedOutcome: ['导入完成'], mustObserve: ['Imported'], mustNotObserve: [], businessRules: [], semanticRubric: [], deterministicAssertions: [{ assertionId: 'assert-imported', type: 'text_visible', target: 'Imported', expected: true, negated: false }], inconclusiveWhen: [] },
    coverageDimensions: [], riskLevel: 'P1', generationReason: 'fixture', version: 1, stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 0, lastExecutedAt: null }, regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: now, updatedAt: now,
  };
}

async function authState(targetUrl: string): Promise<{ path: string; projectRoot: string }> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'evalpilot-prereq-project-'));
  const secureDir = await mkdtemp(join(tmpdir(), 'evalpilot-prereq-auth-'));
  const path = join(secureDir, 'storage-state.json');
  await writeFile(path, JSON.stringify({ cookies: [], origins: [{ origin: new URL(targetUrl).origin, localStorage: [{ name: 'session', value: 'valid-session' }] }] }), 'utf8');
  if (process.platform !== 'win32') await chmod(path, 0o600);
  return { path, projectRoot };
}

describe('Prerequisite Planner', () => {
  it('composes Auth -> Setup -> File -> Target only when all three are independently resolvable', async () => {
    const targetUrl = 'http://127.0.0.1:41041/';
    const auth = await authState(targetUrl);
    const productModel = model();
    const caseValue = evalCase();
    const scenario = compileExecutableScenario({ evalCase: caseValue, productModel, targetUrl, generatedAt: now });
    expect(new Set(scenario.blockers.map((blocker) => blocker.type))).toEqual(new Set(['needs_auth', 'needs_setup', 'needs_test_data']));

    const plan = await planScenarioPrerequisites({ scenario, evalCase: caseValue, productModel, targetUrl, projectRoot: auth.projectRoot, authStorageStatePath: auth.path, generatedAt: now });
    expect(plan.status).toBe('ready');
    expect(plan.executionOrder).toEqual(['auth', 'setup', 'file_fixture', 'target']);
    expect(plan.authFixture).not.toBeNull();
    expect(plan.setupPlan?.setupTaskId).toBe('task-create');
    expect(plan.setupPlan?.setupScenario.readiness).toBe('ready');
    expect(plan.fileFixturePlan?.fixtures.map((fixture) => fixture.kind)).toEqual(['csv']);
    expect(plan.unresolvedBlockers).toEqual([]);

    const summary = summarizePrerequisitePlan(plan);
    expect(JSON.stringify(summary)).not.toContain('valid-session');
    expect(summary.auth).toMatchObject({ targetOrigin: new URL(targetUrl).origin, originCount: 1 });
  });

  it('keeps auth and auth-dependent setup blocked when no Auth Fixture exists', async () => {
    const targetUrl = 'http://127.0.0.1:41042/';
    const projectRoot = await mkdtemp(join(tmpdir(), 'evalpilot-prereq-no-auth-'));
    const productModel = model();
    const caseValue = evalCase();
    const scenario = compileExecutableScenario({ evalCase: caseValue, productModel, targetUrl, generatedAt: now });
    const plan = await planScenarioPrerequisites({ scenario, evalCase: caseValue, productModel, targetUrl, projectRoot, authStorageStatePath: null, generatedAt: now });

    expect(plan.status).toBe('blocked');
    expect(plan.authFixture).toBeNull();
    expect(plan.setupPlan).toBeNull();
    expect(plan.fileFixturePlan).not.toBeNull();
    expect(plan.unresolvedBlockers.some((blocker) => blocker.type === 'needs_auth')).toBe(true);
    expect(plan.unresolvedBlockers.some((blocker) => blocker.type === 'needs_setup')).toBe(true);
  });

  it('never hides a human prerequisite behind otherwise resolvable automation', async () => {
    const targetUrl = 'http://127.0.0.1:41043/';
    const auth = await authState(targetUrl);
    const productModel = model();
    const caseValue = evalCase(['需要人工确认真实业务规则']);
    const scenario = compileExecutableScenario({ evalCase: caseValue, productModel, targetUrl, generatedAt: now });
    const plan = await planScenarioPrerequisites({ scenario, evalCase: caseValue, productModel, targetUrl, projectRoot: auth.projectRoot, authStorageStatePath: auth.path, generatedAt: now });

    expect(plan.status).toBe('blocked');
    expect(plan.authFixture).not.toBeNull();
    expect(plan.fileFixturePlan).not.toBeNull();
    expect(plan.unresolvedBlockers.some((blocker) => blocker.type === 'needs_human_input')).toBe(true);
  });
});
