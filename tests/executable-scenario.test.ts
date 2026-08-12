import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { EvalCase, ProductModel } from '../types.js';
import { compileExecutableScenario, compileExecutableScenarios, scenarioBlockerSummary } from '../src/scenario/scenario-compiler.js';

const now = '2026-08-12T05:00:00.000Z';

function model(): ProductModel {
  return {
    projectId: 'project-demo',
    version: 1,
    generatedAt: now,
    productName: 'Demo',
    productType: 'Web App',
    targetUsers: [],
    capabilities: [{
      capabilityId: 'cap-project',
      name: '项目',
      description: '创建和管理项目',
      routes: ['/projects'],
      entryPoints: ['/projects'],
      userGoals: ['管理项目'],
      supportedTasks: ['task-project'],
      importance: 'critical',
      evidenceStatus: 'verified',
      evidence: [],
      needsHumanReview: false,
    }],
    userTasks: [{
      taskId: 'task-project',
      capabilityId: 'cap-project',
      name: '管理项目',
      goal: '完成项目任务',
      preconditions: [],
      successConditions: ['完成'],
      evidenceStatus: 'verified',
      evidence: [],
      needsHumanReview: false,
    }],
    businessRules: [],
    knownRisks: [],
    unknowns: [],
    evidence: [],
  };
}

function evalCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    caseId: 'case-project',
    projectId: 'project-demo',
    setType: 'baseline',
    status: 'stable',
    origin: { type: 'human', note: 'scenario compiler fixture' },
    capabilityId: 'cap-project',
    taskId: 'task-project',
    title: '项目任务',
    hypothesis: '用户可以完成项目任务',
    persona: { personaId: 'persona', name: '用户', behaviorPolicy: ['使用安全操作'] },
    goal: '完成项目任务',
    knownInformation: {},
    preconditions: [],
    oracle: { expectedOutcome: ['完成'], mustObserve: [], mustNotObserve: [], businessRules: [], semanticRubric: [], deterministicAssertions: [], inconclusiveWhen: [] },
    coverageDimensions: [],
    riskLevel: 'P1',
    generationReason: 'fixture',
    version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 0, lastExecutedAt: null },
    regressionMetadata: null,
    retirementReason: null,
    needsHumanReview: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('Executable Scenario compiler', () => {
  it('keeps simple reachable-page prerequisites ready and resolves a relative starting URL', () => {
    const scenario = compileExecutableScenario({
      evalCase: evalCase({ preconditions: ['项目页面已打开'] }),
      productModel: model(),
      targetUrl: 'http://127.0.0.1:3000',
      generatedAt: now,
    });
    expect(scenario.readiness).toBe('ready');
    expect(scenario.startingUrl).toBe('http://127.0.0.1:3000/projects');
    expect(scenario.blockers).toEqual([]);
    expect(scenario.preconditions).toEqual([{ text: '项目页面已打开', status: 'satisfied', reason: '该条件由项目 Readiness / 起始页面检查负责。' }]);
  });

  it('blocks an existing-object task before the Agent runs', () => {
    const scenario = compileExecutableScenario({
      evalCase: evalCase({ preconditions: ['已有一个已创建的项目'] }),
      productModel: model(),
      targetUrl: 'http://127.0.0.1:3000',
      generatedAt: now,
    });
    expect(scenario.readiness).toBe('needs_setup');
    expect(scenario.blockers[0]).toMatchObject({ type: 'needs_setup', source: 'precondition' });
  });

  it('classifies login prerequisites separately from ordinary setup', () => {
    const scenario = compileExecutableScenario({
      evalCase: evalCase({ preconditions: ['用户已登录测试账号'] }),
      productModel: model(),
      targetUrl: 'http://127.0.0.1:3000',
      generatedAt: now,
    });
    expect(scenario.readiness).toBe('needs_auth');
    expect(scenario.blockers[0]?.summary).toContain('测试登录态');
  });

  it('classifies fixture-file prerequisites as missing test data', () => {
    const scenario = compileExecutableScenario({
      evalCase: evalCase({ preconditions: ['准备一个待上传测试文件'] }),
      productModel: model(),
      targetUrl: 'http://127.0.0.1:3000',
      generatedAt: now,
    });
    expect(scenario.readiness).toBe('needs_test_data');
  });

  it('accepts a prerequisite that is explicitly backed by knownInformation', () => {
    const scenario = compileExecutableScenario({
      evalCase: evalCase({ preconditions: ['project_name 已提供'], knownInformation: { project_name: 'Safe demo' } }),
      productModel: model(),
      targetUrl: 'http://127.0.0.1:3000',
      generatedAt: now,
    });
    expect(scenario.readiness).toBe('ready');
    expect(scenario.knownInformationKeys).toEqual(['project_name']);
  });

  it('refuses a stale case whose Product Task no longer exists', () => {
    const scenario = compileExecutableScenario({
      evalCase: evalCase({ taskId: 'task-missing' }),
      productModel: model(),
      targetUrl: 'http://127.0.0.1:3000',
      generatedAt: now,
    });
    expect(scenario.readiness).toBe('unsupported');
    expect(scenario.blockers[0]).toMatchObject({ type: 'unsupported', source: 'product_model' });
  });

  it('summarizes all blocked scenarios without pretending they were executed', () => {
    const scenarios = compileExecutableScenarios({
      cases: [
        evalCase({ caseId: 'case-auth', preconditions: ['用户已登录测试账号'] }),
        evalCase({ caseId: 'case-existing', preconditions: ['已有一个项目'] }),
      ],
      productModel: model(),
      targetUrl: 'http://127.0.0.1:3000',
      generatedAt: now,
    });
    const summary = scenarioBlockerSummary(scenarios);
    expect(summary).toContain('case-auth');
    expect(summary).toContain('case-existing');
    expect(summary).toContain('测试登录态');
    expect(summary).toContain('Setup');
  });

  it('keeps the browser launch after scenario preflight in the orchestrator', async () => {
    const source = await readFile(new URL('../src/evaluation/evaluation-orchestrator.ts', import.meta.url), 'utf8');
    const compileIndex = source.indexOf('compileExecutableScenarios');
    const blockerIndex = source.indexOf("'EVALUATION_SCENARIO_NOT_READY'");
    const browserIndex = source.indexOf('chromium.launch');
    expect(compileIndex).toBeGreaterThan(-1);
    expect(blockerIndex).toBeGreaterThan(compileIndex);
    expect(browserIndex).toBeGreaterThan(blockerIndex);
  });
});
