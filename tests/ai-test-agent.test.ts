import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import type { AiStructuredRequest, EvalCase, ProductModel } from '../types.js';
import { MockAiProvider } from '../src/ai/mock-provider.js';
import { OpenAiProvider } from '../src/ai/openai-provider.js';
import { AiProviderError } from '../src/ai/provider.js';
import { runAiTestAgent } from '../src/test-agent/agent-runner.js';
import { generateSafeInput } from '../src/test-agent/safe-input-generator.js';
import { agentDecisionSchema } from '../src/test-agent/schemas.js';
import { runAdaptiveCase } from '../src/evaluation/adaptive-evaluation-service.js';
import { loadEvalSetCases } from '../src/eval-set/eval-set-store.js';
import { loadLatestCoverageMatrix } from '../src/eval-set/coverage-store.js';
import { listFindings } from '../src/findings/finding-store.js';
import { markBadcaseFixed } from '../src/badcase/badcase-service.js';
import { promoteFixedBadcaseToRegression } from '../src/badcase/regression-promoter.js';
import { loadRegressionCases } from '../src/eval-set/regression-store.js';

const now = '2026-08-01T09:00:00.000Z';

function evalCase(): EvalCase {
  return {
    caseId: 'case-create', projectId: 'project-fixture', setType: 'baseline', status: 'stable',
    origin: { type: 'human', note: 'AI Test Agent fixture' }, capabilityId: 'cap-create', taskId: 'task-create', title: '创建测试项目', hypothesis: '新用户可完成创建',
    persona: { personaId: 'persona-new', name: '新用户', behaviorPolicy: ['允许一次重试', '只使用可见控件'] }, goal: '创建测试项目', knownInformation: { project_name: 'Safe demo' }, preconditions: ['页面已打开'],
    oracle: { expectedOutcome: ['显示 Created'], mustObserve: ['Created'], mustNotObserve: ['Error'], businessRules: [], semanticRubric: ['用户能看见完成结果'], deterministicAssertions: [{ assertionId: 'assert-created', type: 'text_visible', target: 'Created', expected: true, negated: false }], inconclusiveWhen: ['浏览器不可用'] },
    coverageDimensions: [{ dimension: 'capability', value: 'cap-create' }], riskLevel: 'P1', generationReason: '浏览器 fixture', version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 1, lastExecutedAt: null }, regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: now, updatedAt: now,
  };
}

function request(overrides: Partial<AiStructuredRequest> = {}): AiStructuredRequest {
  return {
    requestId: 'request-1', task: 'actor', systemPrompt: 'Choose one action', userPrompt: '{}', schemaName: 'agent_decision', imageDataUrls: [],
    privacy: { allowRemoteModel: true, allowScreenshot: false, visibleTextOnly: true, redactionApplied: true }, metadata: {}, ...overrides,
  };
}

describe('AI provider contracts', () => {
  it('retries malformed model output and never silently coerces it', async () => {
    const provider = new MockAiProvider((_request, attempt) => attempt === 0 ? { action: 'click' } : { intentSummary: '完成', action: 'finish', targetElementId: null, value: null, expectedResult: '完成', confidence: 1 });
    await expect(provider.generateStructured(request(), agentDecisionSchema)).resolves.toMatchObject({ action: 'finish' });
    expect(provider.requests).toHaveLength(1);
  });

  it('returns an explicit provider error after malformed output is exhausted', async () => {
    const provider = new MockAiProvider(() => ({ action: 'click' }), 0);
    await expect(provider.generateStructured(request(), agentDecisionSchema)).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
  });

  it('blocks remote calls when privacy consent is absent', async () => {
    let called = false;
    const provider = new OpenAiProvider({ apiKey: 'test-key', model: 'test-model', fetchImplementation: (async () => { called = true; return new Response(); }) as typeof fetch });
    await expect(provider.generateStructured(request({ privacy: { allowRemoteModel: false, allowScreenshot: false, visibleTextOnly: true, redactionApplied: true } }), agentDecisionSchema)).rejects.toBeInstanceOf(AiProviderError);
    expect(called).toBe(false);
  });

  it('uses Responses structured output and validates the returned JSON', async () => {
    let body: Record<string, unknown> | null = null;
    const provider = new OpenAiProvider({
      apiKey: 'test-key', model: 'test-model', maxRetries: 0,
      fetchImplementation: (async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ output_text: JSON.stringify({ intentSummary: '完成', action: 'finish', targetElementId: null, value: null, expectedResult: '完成', confidence: 1 }) }), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch,
    });
    await expect(provider.generateStructured(request(), agentDecisionSchema)).resolves.toMatchObject({ action: 'finish' });
    expect(body).toMatchObject({ model: 'test-model', text: { format: { type: 'json_schema', name: 'agent_decision', strict: true } } });
  });
});

describe('safe input generator', () => {
  const field = { elementId: 'E001', role: null, tagName: 'input', label: 'Project name', text: null, placeholder: 'Project name', disabled: false, risk: 'safe' as const, locatorHint: 'grounded-index:0', fieldName: 'project_name', inputType: 'text', required: true, currentValuePresent: false, options: [] };

  it('prefers explicit case fixtures and records their origin', () => {
    expect(generateSafeInput(field, { project_name: 'Safe demo' }, 'http://127.0.0.1:3000')).toEqual({ status: 'ready', value: 'Safe demo', origin: 'known_fixture', reason: '使用案例提供的 project_name。' });
  });

  it('blocks credentials and non-local email generation', () => {
    expect(generateSafeInput({ ...field, inputType: 'password', risk: 'sensitive' }, {}, 'http://127.0.0.1:3000').status).toBe('blocked_by_safety');
    expect(generateSafeInput({ ...field, inputType: 'email', fieldName: 'email' }, {}, 'https://example.com').status).toBe('blocked_by_safety');
  });
});

describe.skipIf(process.env.EVALPILOT_BROWSER_TEST !== '1')('AI Test Agent browser loop', () => {
  const model: ProductModel = { projectId: 'project-fixture', version: 2, generatedAt: now, productName: 'Fixture', productType: 'Web', targetUsers: [{ userTypeId: 'persona-new', name: '新用户', description: '首次用户', goals: ['创建'], evidenceStatus: 'declared', evidence: [], needsHumanReview: false }], capabilities: [{ capabilityId: 'cap-create', name: '创建', description: '创建项目', routes: ['/'], entryPoints: ['/'], userGoals: ['创建'], supportedTasks: ['task-create'], importance: 'critical', evidenceStatus: 'declared', evidence: [], needsHumanReview: false }], userTasks: [{ taskId: 'task-create', capabilityId: 'cap-create', name: '创建', goal: '创建项目', preconditions: [], successConditions: ['显示 Created'], evidenceStatus: 'declared', evidence: [], needsHumanReview: false }], businessRules: [], knownRisks: [], unknowns: [], evidence: [] };
  it('completes a form from DOM-grounded decisions without selectors in the case', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><head><title>Create</title></head><body><main><h1>Create project</h1><label>Project name <input name="project_name"></label><button type="button" onclick="document.querySelector(\'main\').innerHTML=\'<h1>Created</h1><p>Your project is ready.</p>\'">Create</button></main></body></html>');
    const provider = new MockAiProvider((providerRequest) => {
      const context = JSON.parse(providerRequest.userPrompt) as { observation: { visibleStateSummary: string; formFields: Array<{ elementId: string; currentValuePresent: boolean }>; interactableElements: Array<{ elementId: string; label: string }> } };
      if (context.observation.visibleStateSummary.includes('Your project is ready')) return { intentSummary: '结果已经出现', action: 'finish', targetElementId: null, value: null, expectedResult: '任务完成', confidence: 0.99 };
      const field = context.observation.formFields[0];
      if (field && !field.currentValuePresent) return { intentSummary: '填写项目名称', action: 'fill', targetElementId: field.elementId, value: null, expectedResult: '输入框显示项目名称', confidence: 0.95 };
      const button = context.observation.interactableElements.find((item) => item.label === 'Create');
      return { intentSummary: '提交创建', action: 'click', targetElementId: button?.elementId ?? null, value: null, expectedResult: '显示 Created', confidence: 0.95 };
    });
    const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-ai-agent-'));
    const result = await runAiTestAgent(page, evalCase(), provider, { outputDir, startingUrl: page.url(), maxSteps: 5, now: () => new Date(now) });
    expect(result).toMatchObject({ status: 'completed', failureSource: null });
    expect(result.decisions.map((item) => item.action)).toEqual(['fill', 'click', 'finish']);
    expect(result.actionResults[0]).toMatchObject({ status: 'executed', targetElementId: 'E001' });
    expect(provider.requests.every((item) => item.imageDataUrls[0]?.startsWith('data:image/png;base64,'))).toBe(true);
    expect(provider.requests.filter((item) => item.task === 'actor').every((item) => item.userPrompt.includes('interactableElements'))).toBe(true);
    const packet = JSON.parse(await readFile(result.evidencePacketPath, 'utf8')) as { actions: unknown[]; stepEvidence: Array<{ beforeScreenshotPath: string; afterScreenshotPath: string; taskState: { state: string } | null }>; tracePath: string | null; evidenceCompleteness: { complete: boolean } };
    expect(packet.evidenceCompleteness.complete).toBe(true);
    expect(packet.stepEvidence).toHaveLength(packet.actions.length);
    expect(packet.stepEvidence.at(-1)?.afterScreenshotPath).toMatch(/step-003-after\.png$/);
    expect(packet.stepEvidence.every((step) => step.beforeScreenshotPath !== step.afterScreenshotPath)).toBe(true);
    expect(packet.stepEvidence.every((step) => step.taskState !== null)).toBe(true);
    expect(packet.stepEvidence.some((step) => step.taskState?.state === 'completed')).toBe(true);
    await expect(stat(join(outputDir, 'runs', result.runId, 'task-state-observations.jsonl'))).resolves.toBeTruthy();
    expect(packet.tracePath).toMatch(/trace\.zip$/);
    await browser.close();
  });

  it('blocks destructive actions even when the model selects them', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body><h1>Settings</h1><button>Delete account</button></body></html>');
    const provider = new MockAiProvider(() => ({ intentSummary: '删除账号', action: 'click', targetElementId: 'E001', value: null, expectedResult: '账号删除', confidence: 1 }));
    const result = await runAiTestAgent(page, evalCase(), provider, { outputDir: await mkdtemp(join(tmpdir(), 'evalpilot-ai-safety-')), startingUrl: page.url(), maxSteps: 1, now: () => new Date(now) });
    expect(result.status).toBe('blocked_by_safety');
    expect(result.actionResults[0]?.summary).toContain('已阻止 high 风险操作');
    await browser.close();
  });

  it('waits through progress, records the timeline, and does not consume Persona patience', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent('<main><h1>Report</h1><button onclick="this.disabled=true;this.setAttribute(\'aria-busy\',\'true\');this.textContent=\'Generating 25%\';setTimeout(()=>{this.textContent=\'Generating 75%\'},150);setTimeout(()=>{document.querySelector(\'main\').innerHTML=\'<h1>Report ready</h1>\'},330)">Generate</button></main>');
    const provider = new MockAiProvider(() => ({ intentSummary: '生成报告', action: 'click', targetElementId: 'E001', value: null, expectedResult: 'Report ready', confidence: 1 }));
    const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-ai-progressing-'));
    const lowPatienceCase = { ...evalCase(), persona: { ...evalCase().persona, patienceTurns: 1, retryTolerance: 0 } };
    const result = await runAiTestAgent(page, lowPatienceCase, provider, { outputDir, startingUrl: page.url(), maxSteps: 1, waitPolicy: { initialObservationMs: 50, pollIntervalMs: 100, softTimeoutMs: 180, hardTimeoutMs: 1_000, progressExtensionMs: 250, maxProgressExtensions: 3 }, now: () => new Date(now) });
    const packet = JSON.parse(await readFile(result.evidencePacketPath, 'utf8')) as { actions: unknown[]; stepEvidence: Array<{ taskState: { state: string }; taskWait: { observations: Array<{ state: string }>; extensionsUsed: number; consumedPersonaAttempt: boolean } }>; stepVerifications: Array<{ status: string }> };
    expect(packet.stepEvidence[0]?.taskState.state).toBe('completed');
    expect(packet.stepEvidence[0]?.taskWait.observations.some((item) => item.state === 'progressing')).toBe(true);
    expect(packet.stepEvidence[0]?.taskWait).toMatchObject({ consumedPersonaAttempt: false });
    expect(packet.stepEvidence[0]?.taskWait.extensionsUsed).toBeGreaterThan(0);
    expect(packet.stepEvidence[0]?.taskWait.observations.length).toBeGreaterThan(1);
    expect(packet.actions).toHaveLength(1);
    expect(packet.stepVerifications[0]?.status).toBe('confirmed');
    expect(result.status).toBe('inconclusive');
    await browser.close();
  });

  it('classifies exhausted malformed model output as evaluator inconclusive', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body><h1>Clean page</h1></body></html>');
    const provider = new MockAiProvider(() => ({ malformed: true }), 0);
    const result = await runAiTestAgent(page, evalCase(), provider, { outputDir: await mkdtemp(join(tmpdir(), 'evalpilot-ai-malformed-')), startingUrl: page.url(), maxSteps: 1, now: () => new Date(now) });
    expect(result).toMatchObject({ status: 'inconclusive', failureSource: 'evaluator', error: expect.stringContaining('输出无效') });
    await browser.close();
  });

  it('runs Agent → Hybrid Judge → PASS evolution → 16-section report with version metadata', async () => {
    const browser = await chromium.launch({ headless: true }); const page = await browser.newPage();
    await page.setContent('<!doctype html><html><head><title>Create</title></head><body><main><h1>Create project</h1><label>Project name <input name="project_name"></label><button type="button" onclick="document.querySelector(\'main\').innerHTML=\'<h1>Created</h1><p>Your project is ready.</p>\'">Create</button></main></body></html>');
    const provider = new MockAiProvider((providerRequest) => {
      if (providerRequest.task === 'semantic_judge') return { verdict: 'pass', taskCompletion: 'complete', summary: '用户独立完成创建并看见结果。', whatWorked: ['Created 可见'], whatFailed: [], whyItMatters: [], confirmedFacts: ['Created 可见'], hypotheses: [], unknowns: [], evidenceRefs: ['screenshots/final.png'], confidence: 0.95 };
      const context = JSON.parse(providerRequest.userPrompt) as { observation: { visibleStateSummary: string; formFields: Array<{ elementId: string; currentValuePresent: boolean }>; interactableElements: Array<{ elementId: string; label: string }> } };
      if (context.observation.visibleStateSummary.includes('Your project is ready')) return { intentSummary: '任务完成', action: 'finish', targetElementId: null, value: null, expectedResult: 'Created 可见', confidence: 1 };
      const field = context.observation.formFields[0]; if (field && !field.currentValuePresent) return { intentSummary: '填写安全名称', action: 'fill', targetElementId: field.elementId, value: null, expectedResult: '名称已填写', confidence: 1 };
      const button = context.observation.interactableElements.find((item) => item.label === 'Create'); return { intentSummary: '提交', action: 'click', targetElementId: button?.elementId ?? null, value: null, expectedResult: 'Created 可见', confidence: 1 };
    });
    const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-adaptive-pipeline-'));
    const outcome = await runAdaptiveCase({ page, provider, outputDir, evalCase: evalCase(), productModel: model, existingCases: [evalCase()], startingUrl: page.url(), evalSetVersion: 3, targetAppGitSha: 'abc123', now: () => new Date(now) });
    expect(outcome.result).toMatchObject({ verdict: 'pass', failureSource: null });
    expect(outcome.badcase).toBeNull(); expect(outcome.passAnalysis?.challengeCandidates).toHaveLength(3); expect(outcome.report.executiveVerdict).not.toBe('needs_attention');
    const evolvedCases = await loadEvalSetCases(outputDir);
    expect(evolvedCases.filter((item) => item.setType === 'challenge')).toHaveLength(3);
    expect(evolvedCases.filter((item) => item.setType === 'challenge').every((item) => item.status === 'candidate')).toBe(true);
    const coverage = await loadLatestCoverageMatrix(outputDir);
    expect(coverage.gaps.some((gap) => gap.candidateCaseIds.length > 0)).toBe(true);
    const candidateOnlyCells = coverage.cells.filter((cell) => cell.assetStatus === 'candidate');
    expect(candidateOnlyCells.length).toBeGreaterThan(0);
    expect(candidateOnlyCells.every((cell) => !cell.verified)).toBe(true);
    const packet = JSON.parse(await readFile(outcome.agentRun.evidencePacketPath, 'utf8')) as { versions: Record<string, unknown> };
    const runDirectory = join(outputDir, 'runs', outcome.result.runId);
    await expect(stat(join(runDirectory, 'agent-run.json'))).resolves.toBeTruthy();
    await expect(stat(join(runDirectory, 'trace.zip'))).resolves.toBeTruthy();
    expect(packet.versions).toMatchObject({
      targetAppGitSha: 'abc123',
      productModelVersion: 2,
      evalSetVersion: 3,
      caseVersion: 1,
      actorModel: 'evalpilot-mock-v1',
      judgeModel: 'evalpilot-mock-v1',
      verifierPromptVersion: '1.0.0',
      reflectorPromptVersion: null,
      toolSchemaVersion: '1.3.0',
    });
    const markdown = await readFile(join(outputDir, 'reports', 'latest-evaluation.md'), 'utf8'); expect(markdown).toContain('## 16. Authenticity / uncertainty notice');
    await browser.close();
  });

  it('keeps a low-confidence semantic failure as a Candidate Finding without creating a Badcase', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent('<main><h1>Draft</h1><button>Save</button></main>');
    const candidateCase: EvalCase = {
      ...evalCase(),
      caseId: 'case-candidate-dead-click',
      title: '检查保存反馈',
      goal: '确认保存操作是否有清晰反馈',
      oracle: { ...evalCase().oracle, deterministicAssertions: [] },
    };
    const provider = new MockAiProvider((providerRequest) => providerRequest.task === 'semantic_judge'
      ? { verdict: 'fail', taskCompletion: 'failed', summary: '保存按钮可能没有产生反馈。', whatWorked: ['按钮可见'], whatFailed: ['未观察到明确保存状态'], whyItMatters: ['用户可能不确定是否保存'], confirmedFacts: ['页面仍显示 Draft'], hypotheses: [], unknowns: ['按钮是否触发后台请求未知'], evidenceRefs: ['screenshots/step-001-after.png'], confidence: 0.55 }
      : { intentSummary: '尝试保存', action: 'click', targetElementId: 'E001', value: null, expectedResult: '出现保存反馈', confidence: 0.9 });
    const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-adaptive-candidate-'));
    const outcome = await runAdaptiveCase({ page, provider, outputDir, evalCase: candidateCase, productModel: model, existingCases: [candidateCase], startingUrl: page.url(), evalSetVersion: 1, agentWaitTimeoutMs: 300, now: () => new Date(now) });
    expect(outcome.result).toMatchObject({ verdict: 'inconclusive', failureSource: 'unknown' });
    expect(outcome.badcase).toBeNull();
    expect(await listFindings(outputDir)).toEqual([expect.objectContaining({ caseId: candidateCase.caseId, status: 'candidate' })]);
    await browser.close();
  });

  it('reports a real dead click, creates a Product Badcase, and promotes a passing retest to Regression', async () => {
    const browser = await chromium.launch({ headless: true }); const page = await browser.newPage(); await page.setContent('<main><h1>Draft</h1><button>Save</button></main>');
    const failedCase: EvalCase = { ...evalCase(), caseId: 'case-dead-click', title: '保存草稿', goal: '保存草稿', hypothesis: '点击保存后显示 Saved', oracle: { ...evalCase().oracle, expectedOutcome: ['显示 Saved'], mustObserve: ['Saved'], deterministicAssertions: [{ assertionId: 'assert-saved', type: 'text_visible', target: 'Saved', expected: true, negated: false }] } };
    const provider = new MockAiProvider((providerRequest) => providerRequest.task === 'semantic_judge'
      ? { verdict: 'fail', taskCompletion: 'failed', summary: '保存按钮点击后没有反馈。', whatWorked: ['保存按钮可见'], whatFailed: ['连续点击没有任何稳定变化'], whyItMatters: ['用户无法确认草稿是否保存'], confirmedFacts: ['按钮点击前后页面文字和 URL 均未变化'], hypotheses: [{ hypothesis: '按钮未连接保存动作', confidence: 0.7, supportingEvidence: ['浏览器步骤截图'], contradictingEvidence: [], howToVerify: ['检查 Save 点击处理器'] }], unknowns: ['后端是否收到请求未知'], evidenceRefs: ['screenshots/step-02.png'], confidence: 0.9 }
      : { intentSummary: '尝试保存', action: 'click', targetElementId: 'E001', value: null, expectedResult: '显示 Saved', confidence: 1 });
    const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-adaptive-fail-'));
    const outcome = await runAdaptiveCase({ page, provider, outputDir, evalCase: failedCase, productModel: model, existingCases: [failedCase], startingUrl: page.url(), evalSetVersion: 1, agentWaitTimeoutMs: 300, now: () => new Date(now) });
    expect(outcome.agentRun.status).toBe('abandoned'); expect(outcome.result).toMatchObject({ verdict: 'fail', failureSource: 'product', severity: 'P1' });
    expect(outcome.badcase).toMatchObject({ caseId: 'case-dead-click', category: 'interaction', confirmedFacts: ['按钮点击前后页面文字和 URL 均未变化'] });
    expect(outcome.report.failures[0]?.evidenceRefs).toContain('screenshots/step-02.png');

    await page.setContent('<main><h1>Draft</h1><button onclick="document.querySelector(\'main\').innerHTML=\'<h1>Saved</h1><p>Draft saved.</p>\'">Save</button></main>');
    const retestProvider = new MockAiProvider((providerRequest) => {
      if (providerRequest.task === 'semantic_judge') return { verdict: 'pass', taskCompletion: 'complete', summary: '保存后显示 Saved。', whatWorked: ['Saved 可见'], whatFailed: [], whyItMatters: [], confirmedFacts: ['Saved 可见'], hypotheses: [], unknowns: [], evidenceRefs: [], confidence: 0.95 };
      const context = JSON.parse(providerRequest.userPrompt) as { observation: { visibleStateSummary: string } };
      return context.observation.visibleStateSummary.includes('Draft saved')
        ? { intentSummary: '保存成功', action: 'finish', targetElementId: null, value: null, expectedResult: 'Saved 可见', confidence: 1 }
        : { intentSummary: '保存草稿', action: 'click', targetElementId: 'E001', value: null, expectedResult: 'Saved 可见', confidence: 1 };
    });
    const fixedAt = '2026-08-01T09:10:00.000Z';
    const retest = await runAdaptiveCase({ page, provider: retestProvider, outputDir, evalCase: failedCase, productModel: model, existingCases: [failedCase], startingUrl: page.url(), evalSetVersion: 1, now: () => new Date(fixedAt) });
    expect(retest.result).toMatchObject({ verdict: 'pass', failureSource: null });
    const fixedBadcase = await markBadcaseFixed(outputDir, outcome.badcase!, fixedAt);
    const promoted = await promoteFixedBadcaseToRegression({ outputDir, badcase: fixedBadcase, sourceCase: failedCase, passingRetest: retest.result, fixedAt });
    expect(promoted.regressionCase).toMatchObject({ setType: 'regression', status: 'stable', regressionMetadata: { sourceRunId: outcome.result.runId } });
    expect(promoted.badcase).toMatchObject({ fixStatus: 'fixed', regressionCaseId: promoted.regressionCase.caseId });
    expect(await loadRegressionCases(outputDir)).toEqual([expect.objectContaining({ caseId: promoted.regressionCase.caseId })]);
    await browser.close();
  });
});
