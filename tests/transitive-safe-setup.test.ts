import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import type { EvalCase, ProductModel, ProductTask } from '../types.js';
import { MockAiProvider } from '../src/ai/mock-provider.js';
import { compileExecutableScenario } from '../src/scenario/scenario-compiler.js';
import { planScenarioPrerequisites, summarizePrerequisitePlan } from '../src/scenario/prerequisite-planner.js';
import { runAutoSetup } from '../src/scenario/setup-runner.js';

const browserIt = process.env.EVALPILOT_BROWSER_TEST === '1' ? it : it.skip;
const now = '2026-08-12T12:00:00.000Z';
const evidence = [{ claim: 'transitive setup fixture', sourceType: 'repository' as const, source: 'tests/transitive-safe-setup.test.ts', status: 'verified' as const }];
let browser: Browser | null = null;

afterEach(async () => { await browser?.close(); browser = null; });

function task(input: { taskId: string; name: string; goal: string; preconditions: string[]; signalId: string; signalTarget: string }): ProductTask {
  return {
    taskId: input.taskId,
    capabilityId: 'cap-workflow',
    name: input.name,
    goal: input.goal,
    preconditions: input.preconditions,
    successConditions: [input.signalTarget],
    successSignals: [{ signalId: input.signalId, kind: 'text_visible', target: input.signalTarget, description: `页面显示 ${input.signalTarget}`, evidenceStatus: 'verified', evidence, needsHumanReview: false }],
    businessRuleIds: [],
    evidenceStatus: 'verified',
    evidence,
    needsHumanReview: false,
  };
}

function model(): ProductModel {
  const create = task({ taskId: 'task-create', name: '创建对象', goal: '创建测试对象', preconditions: ['项目页面已打开'], signalId: 'signal-created', signalTarget: 'Created' });
  const record = task({ taskId: 'task-record', name: '记录子对象', goal: '向已有对象记录测试子项', preconditions: ['已有一个已创建对象'], signalId: 'signal-recorded', signalTarget: 'Recorded' });
  const daily = task({ taskId: 'task-daily', name: '执行每日检查', goal: '对已有记录执行每日检查', preconditions: ['已有一个已创建对象', '已有测试子项记录'], signalId: 'signal-checked', signalTarget: 'Checked' });
  return {
    projectId: 'project-transitive-setup', version: 1, generatedAt: now, productName: 'Transitive Setup Fixture', productType: 'Web App', targetUsers: [],
    capabilities: [{ capabilityId: 'cap-workflow', name: '工作流', description: '线性状态工作流', routes: ['/'], entryPoints: ['/'], userGoals: ['完成完整工作流'], supportedTasks: [create.taskId, record.taskId, daily.taskId], importance: 'critical', evidenceStatus: 'verified', evidence, needsHumanReview: false }],
    userTasks: [create, record, daily], objectLifecycles: [],
    crossPageJourneys: [{ journeyId: 'journey-linear', name: '创建后记录再检查', taskIds: [create.taskId, record.taskId, daily.taskId], routes: ['/'], successConditions: ['完整链路完成'], evidenceStatus: 'verified', evidence, needsHumanReview: false }],
    businessRules: [], knownRisks: [], unknowns: [], evidence,
  };
}

function dailyCase(): EvalCase {
  return {
    caseId: 'case-daily', projectId: 'project-transitive-setup', setType: 'baseline', status: 'stable', origin: { type: 'human', note: 'transitive fixture' }, capabilityId: 'cap-workflow', taskId: 'task-daily', title: '执行每日检查', hypothesis: '完整前置状态建立后可以检查', persona: { personaId: 'persona', name: '测试用户', behaviorPolicy: ['只执行安全操作'] }, goal: '对已有记录执行每日检查', knownInformation: {}, preconditions: ['已有一个已创建对象', '已有测试子项记录'],
    oracle: { expectedOutcome: ['Checked'], mustObserve: ['Checked'], mustNotObserve: [], businessRules: [], semanticRubric: [], deterministicAssertions: [{ assertionId: 'assert-checked', type: 'text_visible', target: 'Checked', expected: true, negated: false }], inconclusiveWhen: [] },
    coverageDimensions: [], riskLevel: 'P1', generationReason: 'fixture', version: 1, stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 0, lastExecutedAt: null }, regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: now, updatedAt: now,
  };
}

async function fixtureServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><body><main></main><script>
      const main=document.querySelector('main');
      function render(){
        if(!localStorage.getItem('created')) main.innerHTML='<h1>Create</h1><label>Name <input name="name"></label><button onclick="localStorage.setItem(\\'created\\',\\'1\\');document.querySelector(\\'main\\').innerHTML=\\'<h1>Created</h1>\\'">Create</button>';
        else if(!localStorage.getItem('recorded')) main.innerHTML='<h1>Existing object</h1><button onclick="localStorage.setItem(\\'recorded\\',\\'1\\');document.querySelector(\\'main\\').innerHTML=\\'<h1>Recorded</h1>\\'">Record</button>';
        else main.innerHTML='<h1>Ready for daily check</h1><p>Created</p><p>Recorded</p>';
      }
      render();
    </script></body></html>`);
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture server did not expose a port');
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())) };
}

function provider(): MockAiProvider {
  return new MockAiProvider((request) => {
    if (request.task === 'semantic_verifier') return { status: 'confirmed', observed: '页面状态发生预期变化。', confirmedFacts: ['状态已变化'], unknowns: [], evidenceRefs: [], confidence: 0.95 };
    const prompt = JSON.parse(request.userPrompt) as { observation: { visibleStateSummary: string; formFields: Array<{ elementId: string; currentValuePresent: boolean }>; interactableElements: Array<{ elementId: string; label: string }> } };
    const visible = prompt.observation.visibleStateSummary;
    if (visible.includes('Created') || visible.includes('Recorded')) return { intentSummary: '当前 Setup 已完成', action: 'finish', targetElementId: null, value: null, expectedResult: '成功信号可见', confidence: 1 };
    const field = prompt.observation.formFields.find((item) => !item.currentValuePresent);
    if (field) return { intentSummary: '填写安全测试数据', action: 'fill', targetElementId: field.elementId, value: 'EvalPilot', expectedResult: '字段已填写', confidence: 1 };
    const action = prompt.observation.interactableElements.find((item) => item.label === 'Create' || item.label === 'Record');
    return { intentSummary: `执行 ${action?.label ?? 'Setup'}`, action: 'click', targetElementId: action?.elementId ?? null, value: null, expectedResult: 'Setup 成功信号可见', confidence: 1 };
  });
}

function executionDiagnostic(execution: Awaited<ReturnType<typeof runAutoSetup>>): string {
  return JSON.stringify({
    status: execution.status,
    summary: execution.summary,
    steps: execution.steps?.map((step) => ({
      setupTaskId: step.setupTaskId,
      status: step.status,
      agentStatus: step.agentStatus,
      blockedRemoteRequests: step.blockedRemoteRequests,
      deterministic: step.deterministic.checks,
      summary: step.summary,
    })),
  }, null, 2);
}

describe('Transitive Safe Setup', () => {
  it('plans every verified prior task in the unique linear journey instead of blocking on two predecessors', async () => {
    const productModel = model();
    const evalCase = dailyCase();
    const targetUrl = 'http://127.0.0.1:41071/';
    const scenario = compileExecutableScenario({ evalCase, productModel, targetUrl, generatedAt: now });
    const plan = await planScenarioPrerequisites({ scenario, evalCase, productModel, targetUrl, projectRoot: await mkdtemp(join(tmpdir(), 'evalpilot-transitive-plan-')), generatedAt: now });

    expect(plan.status).toBe('ready');
    expect(plan.setupPlans.map((item) => item.setupTaskId)).toEqual(['task-create', 'task-record']);
    expect(plan.executionOrder).toEqual(['setup', 'setup', 'target']);
    expect(plan.setupPlan?.chainSteps?.map((item) => item.setupTaskId)).toEqual(['task-create', 'task-record']);
    expect(plan.unresolvedBlockers).toEqual([]);
    const summary = summarizePrerequisitePlan(plan);
    expect(summary.setup).toBeNull();
    expect(summary.setupChain.map((item) => item.setupTaskId)).toEqual(['task-create', 'task-record']);
  });

  browserIt('executes Create -> Record sequentially in one browser context and preserves both verified states', async () => {
    const fixture = await fixtureServer();
    try {
      const productModel = model();
      const evalCase = dailyCase();
      const scenario = compileExecutableScenario({ evalCase, productModel, targetUrl: fixture.url, generatedAt: now });
      const plan = await planScenarioPrerequisites({ scenario, evalCase, productModel, targetUrl: fixture.url, projectRoot: await mkdtemp(join(tmpdir(), 'evalpilot-transitive-browser-')), generatedAt: now });
      expect(plan.status).toBe('ready');
      expect(plan.setupPlan?.chainSteps).toHaveLength(2);

      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      const page = await context.newPage();
      const execution = await runAutoSetup({ page, provider: provider(), outputDir: await mkdtemp(join(tmpdir(), 'evalpilot-transitive-output-')), plan: plan.setupPlan!, productModel, evalSetVersion: 1, allowRemoteModel: true, allowScreenshotToProvider: false, now: () => new Date(now) });

      expect(execution.status, executionDiagnostic(execution)).toBe('passed');
      expect(execution.steps?.map((step) => [step.setupTaskId, step.status])).toEqual([['task-create', 'passed'], ['task-record', 'passed']]);
      expect(await page.evaluate(() => [localStorage.getItem('created'), localStorage.getItem('recorded')])).toEqual(['1', '1']);
      await page.reload();
      expect(await page.getByText('Ready for daily check').isVisible()).toBe(true);
      await context.close();
    } finally {
      await fixture.close();
    }
  });
});
