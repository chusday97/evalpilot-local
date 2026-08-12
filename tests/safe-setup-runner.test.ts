import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import type { EvalCase, ProductModel, ProductTask } from '../types.js';
import { MockAiProvider } from '../src/ai/mock-provider.js';
import { compileExecutableScenario } from '../src/scenario/scenario-compiler.js';
import { resolveScenarioSetup } from '../src/scenario/setup-resolver.js';
import { runAutoSetup } from '../src/scenario/setup-runner.js';

const browserIt = process.env.EVALPILOT_BROWSER_TEST === '1' ? it : it.skip;
const now = '2026-08-12T08:00:00.000Z';
const evidence = [{ claim: 'browser fixture', sourceType: 'repository' as const, source: 'tests/safe-setup-runner.test.ts', status: 'verified' as const }];
let browser: Browser | null = null;

afterEach(async () => { await browser?.close(); browser = null; });

function productTask(overrides: Partial<ProductTask> = {}): ProductTask {
  return {
    taskId: 'task-create', capabilityId: 'cap-project', name: '创建项目', goal: '创建一个测试项目', preconditions: ['项目页面已打开'], successConditions: ['项目创建成功'],
    successSignals: [{ signalId: 'signal-created', kind: 'text_visible', target: 'Created', description: '页面显示 Created', evidenceStatus: 'verified', evidence, needsHumanReview: false }],
    businessRuleIds: [], evidenceStatus: 'verified', evidence, needsHumanReview: false, ...overrides,
  };
}

function productModel(): ProductModel {
  const createTask = productTask();
  const editTask = productTask({ taskId: 'task-edit', name: '编辑项目', goal: '编辑已有项目', preconditions: ['已有一个已创建的项目'], successConditions: ['项目编辑成功'], successSignals: [{ signalId: 'signal-updated', kind: 'text_visible', target: 'Updated', description: '页面显示 Updated', evidenceStatus: 'verified', evidence, needsHumanReview: false }] });
  return {
    projectId: 'project-setup', version: 1, generatedAt: now, productName: 'Setup Fixture', productType: 'Web App', targetUsers: [],
    capabilities: [{ capabilityId: 'cap-project', name: '项目', description: '项目管理', routes: ['/projects'], entryPoints: ['/projects'], userGoals: ['管理项目'], supportedTasks: ['task-create', 'task-edit'], importance: 'critical', evidenceStatus: 'verified', evidence, needsHumanReview: false }],
    userTasks: [createTask, editTask], objectLifecycles: [], crossPageJourneys: [{ journeyId: 'journey-project', name: '创建后编辑', taskIds: ['task-create', 'task-edit'], routes: ['/projects'], successConditions: ['项目可以创建后编辑'], evidenceStatus: 'verified', evidence, needsHumanReview: false }], businessRules: [], knownRisks: [], unknowns: [], evidence,
  };
}

function targetCase(): EvalCase {
  return {
    caseId: 'case-edit', projectId: 'project-setup', setType: 'baseline', status: 'stable', origin: { type: 'human', note: 'setup browser fixture' }, capabilityId: 'cap-project', taskId: 'task-edit', title: '编辑已有项目', hypothesis: '已有项目可编辑', persona: { personaId: 'persona', name: '测试用户', behaviorPolicy: ['只执行安全操作'] }, goal: '编辑已有项目', knownInformation: { project_name: 'EvalPilot Setup' }, preconditions: ['已有一个已创建的项目'],
    oracle: { expectedOutcome: ['项目编辑成功'], mustObserve: ['Updated'], mustNotObserve: [], businessRules: [], semanticRubric: [], deterministicAssertions: [{ assertionId: 'assert-updated', type: 'text_visible', target: 'Updated', expected: true, negated: false }], inconclusiveWhen: [] }, coverageDimensions: [], riskLevel: 'P1', generationReason: 'fixture', version: 1, stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 0, lastExecutedAt: null }, regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: now, updatedAt: now,
  };
}

async function fixtureServer(remoteBusinessRequest = false): Promise<{ url: string; close: () => Promise<void> }> {
  const remoteAttempt = remoteBusinessRequest ? "fetch('https://example.com/api/setup',{method:'POST',body:'test'}).catch(()=>{});" : '';
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><body><main><h1>Projects</h1><label>Project name <input name="project_name"></label><button id="create" onclick="${remoteAttempt}localStorage.setItem('project','created');document.querySelector('main').innerHTML='<h1>Created</h1><p>Project ready</p>'">Create</button></main></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture server did not expose a port');
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

function setupProvider(): MockAiProvider {
  return new MockAiProvider((request) => {
    if (request.task === 'semantic_verifier') return { status: 'confirmed', observed: '可见状态符合预期。', confirmedFacts: ['页面状态发生预期变化'], unknowns: [], evidenceRefs: [], confidence: 0.95 };
    const prompt = JSON.parse(request.userPrompt) as { observation: { visibleStateSummary: string; formFields: Array<{ elementId: string; currentValuePresent: boolean }>; interactableElements: Array<{ elementId: string; label: string }> } };
    if (prompt.observation.visibleStateSummary.includes('Project ready')) return { intentSummary: 'Setup 已完成', action: 'finish', targetElementId: null, value: null, expectedResult: 'Created 可见', confidence: 1 };
    const field = prompt.observation.formFields[0];
    if (field && !field.currentValuePresent) return { intentSummary: '填写测试项目名', action: 'fill', targetElementId: field.elementId, value: 'EvalPilot Setup', expectedResult: '项目名称已填写', confidence: 1 };
    const button = prompt.observation.interactableElements.find((item) => item.label === 'Create');
    return { intentSummary: '创建测试项目', action: 'click', targetElementId: button?.elementId ?? null, value: null, expectedResult: 'Created 可见', confidence: 1 };
  });
}

async function setupPlan(url: string) {
  const model = productModel();
  const evalCase = targetCase();
  const scenario = compileExecutableScenario({ evalCase, productModel: model, targetUrl: url, generatedAt: now });
  const resolution = resolveScenarioSetup({ scenario, evalCase, productModel: model, targetUrl: url, generatedAt: now });
  expect(resolution.status).toBe('auto_setup');
  expect(resolution.plan).not.toBeNull();
  return { model, plan: resolution.plan! };
}

describe('Safe Setup Runner', () => {
  browserIt('creates verified local state and keeps it available in the same browser context', async () => {
    const fixture = await fixtureServer();
    try {
      const { model, plan } = await setupPlan(fixture.url);
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      const page = await context.newPage();
      const result = await runAutoSetup({ page, provider: setupProvider(), outputDir: await mkdtemp(join(tmpdir(), 'evalpilot-safe-setup-')), plan, productModel: model, evalSetVersion: 1, allowRemoteModel: true, allowScreenshotToProvider: false, now: () => new Date(now) });

      expect(result.status).toBe('passed');
      expect(result.blockedRemoteRequests).toEqual([]);
      expect(result.deterministic.checks).toEqual([expect.objectContaining({ verdict: 'pass' })]);
      expect(await page.evaluate(() => localStorage.getItem('project'))).toBe('created');
      await page.reload();
      expect(await page.evaluate(() => localStorage.getItem('project'))).toBe('created');
      await context.close();
    } finally {
      await fixture.close();
    }
  });

  browserIt('fails setup when a localhost frontend tries to call a non-local business API', async () => {
    const fixture = await fixtureServer(true);
    try {
      const { model, plan } = await setupPlan(fixture.url);
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      const result = await runAutoSetup({ page, provider: setupProvider(), outputDir: await mkdtemp(join(tmpdir(), 'evalpilot-safe-setup-remote-')), plan, productModel: model, evalSetVersion: 1, allowRemoteModel: true, allowScreenshotToProvider: false, now: () => new Date(now) });

      expect(result.status).toBe('failed');
      expect(result.deterministic.checks).toEqual([expect.objectContaining({ verdict: 'pass' })]);
      expect(result.blockedRemoteRequests).toEqual([expect.stringContaining('https://example.com/api/setup')]);
      expect(result.summary).toContain('非本地环境');
    } finally {
      await fixture.close();
    }
  });
});
