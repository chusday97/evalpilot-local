import { createServer } from 'node:http';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import type { EvalCase, ProductModel, ProductTask } from '../types.js';
import { MockAiProvider } from '../src/ai/mock-provider.js';
import { runDeterministicJudge } from '../src/judge/deterministic-judge.js';
import { verifyAuthSession } from '../src/scenario/auth-session-verifier.js';
import { materializeSyntheticFileFixtures } from '../src/scenario/file-fixture-resolver.js';
import { planScenarioPrerequisites } from '../src/scenario/prerequisite-planner.js';
import { compileExecutableScenario } from '../src/scenario/scenario-compiler.js';
import { runAutoSetup } from '../src/scenario/setup-runner.js';
import { runAiTestAgent } from '../src/test-agent/agent-runner.js';
import { evidencePacketSchema } from '../src/test-agent/schemas.js';

const browserIt = process.env.EVALPILOT_BROWSER_TEST === '1' ? it : it.skip;
const now = '2026-08-12T10:30:00.000Z';
const evidence = [{ claim: 'combined browser fixture', sourceType: 'repository' as const, source: 'tests/combined-prerequisite-browser.test.ts', status: 'verified' as const }];
let browser: Browser | null = null;

afterEach(async () => { await browser?.close(); browser = null; });

function task(overrides: Partial<ProductTask> = {}): ProductTask {
  return {
    taskId: 'task-create', capabilityId: 'cap-project', name: '创建项目', goal: '创建一个测试项目', preconditions: ['用户已登录测试账号'], successConditions: ['项目创建成功'],
    successSignals: [{ signalId: 'signal-created', kind: 'text_visible', target: 'Created', description: '页面显示 Created', evidenceStatus: 'verified', evidence, needsHumanReview: false }],
    businessRuleIds: [], evidenceStatus: 'verified', evidence, needsHumanReview: false, ...overrides,
  };
}

function productModel(): ProductModel {
  const createTask = task();
  const importTask = task({
    taskId: 'task-import', name: '导入项目数据', goal: '向已有项目导入测试 CSV', preconditions: ['用户已登录测试账号', '已有一个已创建的项目', '测试 CSV 文件已准备'], successConditions: ['导入完成'],
    successSignals: [{ signalId: 'signal-imported', kind: 'text_visible', target: 'Imported', description: '页面显示 Imported', evidenceStatus: 'verified', evidence, needsHumanReview: false }],
  });
  return {
    projectId: 'project-combined', version: 1, generatedAt: now, productName: 'Combined Fixture', productType: 'Web App', targetUsers: [],
    capabilities: [{ capabilityId: 'cap-project', name: '项目', description: '项目管理', routes: ['/projects'], entryPoints: ['/projects'], userGoals: ['管理项目'], supportedTasks: ['task-create', 'task-import'], importance: 'critical', evidenceStatus: 'verified', evidence, needsHumanReview: false }],
    userTasks: [createTask, importTask], objectLifecycles: [], crossPageJourneys: [{ journeyId: 'journey-import', name: '创建后导入', taskIds: ['task-create', 'task-import'], routes: ['/projects'], successConditions: ['创建项目后导入数据'], evidenceStatus: 'verified', evidence, needsHumanReview: false }], businessRules: [], knownRisks: [], unknowns: [], evidence,
  };
}

function targetCase(): EvalCase {
  return {
    caseId: 'case-import', projectId: 'project-combined', setType: 'baseline', status: 'stable', origin: { type: 'human', note: 'combined prerequisite fixture' }, capabilityId: 'cap-project', taskId: 'task-import', title: '登录后向已有项目导入 CSV', hypothesis: '完整前置条件后可导入', persona: { personaId: 'persona', name: '测试用户', behaviorPolicy: ['只执行安全操作'] }, goal: '向已有项目导入测试 CSV', knownInformation: {}, preconditions: ['用户已登录测试账号', '已有一个已创建的项目', '测试 CSV 文件已准备'],
    oracle: { expectedOutcome: ['导入完成'], mustObserve: ['Imported'], mustNotObserve: [], businessRules: [], semanticRubric: [], deterministicAssertions: [{ assertionId: 'assert-imported', type: 'text_visible', target: 'Imported', expected: true, negated: false }], inconclusiveWhen: [] }, coverageDimensions: [], riskLevel: 'P1', generationReason: 'fixture', version: 1, stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 0, lastExecutedAt: null }, regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: now, updatedAt: now,
  };
}

async function fixtureServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><body><main id="root"></main><script>
      const root=document.querySelector('#root');
      const render=()=>{
        if(localStorage.getItem('session')!=='valid-session'){root.innerHTML='<h1>Sign in</h1><input type="password">';return;}
        if(localStorage.getItem('project')!=='created'){
          root.innerHTML='<h1>Projects</h1><label>Project name <input name="project_name"></label><button id="create">Create</button>';
          document.querySelector('#create').addEventListener('click',()=>{localStorage.setItem('project','created');render();});return;
        }
        root.innerHTML='<h1>Project</h1><p>Created</p><input id="file" type="file" accept=".csv"><p id="status">Waiting</p><p id="name"></p>';
        const input=document.querySelector('#file');input.addEventListener('change',()=>{document.querySelector('#name').textContent=input.files[0]?.name||'';document.querySelector('#status').textContent='Processing';setTimeout(()=>{document.querySelector('#status').textContent='Imported'},180);});
      };render();
    </script></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture server did not expose a port');
  return { url: `http://127.0.0.1:${address.port}/projects`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

async function authFixture(url: string): Promise<{ path: string; projectRoot: string }> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'evalpilot-combined-project-'));
  const authDir = await mkdtemp(join(tmpdir(), 'evalpilot-combined-auth-'));
  const path = join(authDir, 'storage-state.json');
  await writeFile(path, JSON.stringify({ cookies: [], origins: [{ origin: new URL(url).origin, localStorage: [{ name: 'session', value: 'valid-session' }] }] }), 'utf8');
  if (process.platform !== 'win32') await chmod(path, 0o600);
  return { path, projectRoot };
}

function provider(): MockAiProvider {
  return new MockAiProvider((request) => {
    if (request.task === 'semantic_verifier') return { status: 'confirmed', observed: '可见状态符合预期。', confirmedFacts: ['页面状态发生预期变化'], unknowns: [], evidenceRefs: [], confidence: 0.95 };
    const prompt = JSON.parse(request.userPrompt) as { observation: { visibleStateSummary: string; formFields: Array<{ elementId: string; inputType: string; currentValuePresent: boolean }>; interactableElements: Array<{ elementId: string; label: string }> } };
    if (prompt.observation.visibleStateSummary.includes('Imported')) return { intentSummary: '目标任务完成', action: 'finish', targetElementId: null, value: null, expectedResult: 'Imported', confidence: 1 };
    const file = prompt.observation.formFields.find((field) => field.inputType === 'file');
    if (file) return { intentSummary: '导入 CSV', action: 'fill', targetElementId: file.elementId, value: '/tmp/not-allowed.csv', expectedResult: 'Imported', confidence: 1 };
    if (prompt.observation.visibleStateSummary.includes('Created')) return { intentSummary: 'Setup 完成', action: 'finish', targetElementId: null, value: null, expectedResult: 'Created', confidence: 1 };
    const textField = prompt.observation.formFields.find((field) => field.inputType !== 'file');
    if (textField && !textField.currentValuePresent) return { intentSummary: '填写合成项目名', action: 'fill', targetElementId: textField.elementId, value: 'EvalPilot Setup', expectedResult: '项目名称已填写', confidence: 1 };
    const create = prompt.observation.interactableElements.find((element) => element.label === 'Create');
    return { intentSummary: '创建测试项目', action: 'click', targetElementId: create?.elementId ?? null, value: null, expectedResult: 'Created', confidence: 1 };
  });
}

describe('Combined Prerequisite Browser Flow', () => {
  browserIt('executes Auth -> Setup -> File -> Target in one browser context and proves the target outcome', async () => {
    const server = await fixtureServer();
    try {
      const auth = await authFixture(server.url);
      const model = productModel();
      const evalCase = targetCase();
      const scenario = compileExecutableScenario({ evalCase, productModel: model, targetUrl: server.url, generatedAt: now });
      const plan = await planScenarioPrerequisites({ scenario, evalCase, productModel: model, targetUrl: server.url, projectRoot: auth.projectRoot, authStorageStatePath: auth.path, generatedAt: now });
      expect(plan.status).toBe('ready');
      expect(plan.executionOrder).toEqual(['auth', 'setup', 'file_fixture', 'target']);

      const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-combined-run-'));
      const files = await materializeSyntheticFileFixtures(plan.fileFixturePlan!, join(outputDir, 'fixtures'));
      const ai = provider();
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({ storageState: plan.authFixture!.storageState });
      const page = await context.newPage();

      const authCheck = await verifyAuthSession(page, scenario.startingUrl);
      expect(authCheck.status).toBe('ready');
      const setup = await runAutoSetup({ page, provider: ai, outputDir, plan: plan.setupPlan!, productModel: model, evalSetVersion: 1, allowRemoteModel: true, allowScreenshotToProvider: false, now: () => new Date(now) });
      expect(setup.status).toBe('passed');
      expect(await page.evaluate(() => localStorage.getItem('project'))).toBe('created');

      const targetRun = await runAiTestAgent(page, evalCase, ai, { outputDir, startingUrl: scenario.startingUrl, fileFixtures: files, allowRemoteModel: true, allowScreenshotToProvider: false, productModelVersion: 1, evalSetVersion: 1, judgeModel: ai.info.model, now: () => new Date(now) });
      const packet = evidencePacketSchema.parse(JSON.parse(await readFile(targetRun.evidencePacketPath, 'utf8')));
      const deterministic = runDeterministicJudge(evalCase, packet);

      expect(targetRun.status).toBe('completed');
      expect(targetRun.decisions.some((decision) => decision.value === '/tmp/not-allowed.csv')).toBe(false);
      expect(targetRun.decisions.some((decision) => decision.value === files[0]!.fixtureId)).toBe(true);
      expect(packet.finalState.visibleTextSummary).toContain('Imported');
      expect(deterministic.hardFailure).toBe(false);
      expect(deterministic.checks).toEqual([expect.objectContaining({ verdict: 'pass' })]);
      await context.close();
    } finally {
      await server.close();
    }
  });
});
