import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import type { AgentActionResult, AgentDecision, EvalCase, PageObservation, TaskStateObservation } from '../types.js';
import { classifyOperation } from '../src/test-agent/operation-classifier.js';
import { captureTaskStateSignals } from '../src/test-agent/task-state-signals.js';
import { consumesPersonaAttempt, waitForProgressAwareOutcome, waitPolicyFor } from '../src/test-agent/progress-aware-wait.js';

const decision = (label: string, action: AgentDecision['action'] = 'click'): AgentDecision => ({ decisionId: 'decision-001', intentSummary: label, action, targetElementId: action === 'click' || action === 'fill' ? 'E001' : null, value: action === 'fill' ? 'demo' : null, expectedResult: label, confidence: 1 });
const observation = (label: string, role: string | null = 'button', tagName = 'button'): PageObservation => ({
  observationId: 'before', pageUrl: 'http://127.0.0.1/', pagePurpose: 'Fixture', visibleStateSummary: label, primaryAreas: [], visibleProblems: [], evidenceRefs: [], confidence: 1,
  interactableElements: [{ elementId: 'E001', role, tagName, label, text: label, placeholder: null, disabled: false, risk: 'safe', locatorHint: 'grounded-index:0' }], formFields: [],
});
const evalCase = (title = '普通任务'): EvalCase => ({
  caseId: 'case-wait', projectId: 'project-wait', setType: 'baseline', status: 'stable', origin: { type: 'human', note: 'fixture' }, capabilityId: 'cap-wait', taskId: null,
  title, hypothesis: title, persona: { personaId: 'persona-low', name: '低耐心用户', patienceTurns: 1, retryTolerance: 0, behaviorPolicy: [] }, goal: title, knownInformation: {}, preconditions: [],
  oracle: { expectedOutcome: [title], mustObserve: [], mustNotObserve: [], businessRules: [], semanticRubric: [], deterministicAssertions: [], inconclusiveWhen: [] }, coverageDimensions: [], riskLevel: 'P1', generationReason: 'fixture', version: 1,
  stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 0, lastExecutedAt: null }, regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
});
const taskState = (state: TaskStateObservation['state']): TaskStateObservation => ({ state, progressSignals: [], completionSignals: [], failureSignals: [], loadingSignals: [], networkActivity: 'idle', elapsedMs: 1, lastProgressAtMs: null, confidence: 1, evidenceRefs: [] });

describe('operation classification and wait policy', () => {
  it('classifies navigation, form, AI, file, unknown and synchronous operations', () => {
    expect(classifyOperation({ decision: decision('打开页面'), observation: observation('Open', 'link', 'a'), evalCase: evalCase() })).toBe('navigation');
    expect(classifyOperation({ decision: decision('打开 AI 助手'), observation: observation('AI Assistant', 'link', 'a'), evalCase: evalCase('AI 工具') })).toBe('navigation');
    expect(classifyOperation({ decision: decision('保存结果'), observation: observation('Save'), evalCase: evalCase() })).toBe('form_submit');
    expect(classifyOperation({ decision: decision('生成报告'), observation: observation('Generate'), evalCase: evalCase('AI 生成报告') })).toBe('ai_generation');
    expect(classifyOperation({ decision: decision('上传文件'), observation: observation('Upload file'), evalCase: evalCase() })).toBe('file_processing');
    expect(classifyOperation({ decision: decision('运行'), observation: observation('Run'), evalCase: evalCase() })).toBe('unknown_async');
    expect(classifyOperation({ decision: decision('填写名称', 'fill'), observation: observation('Name', null, 'input'), evalCase: evalCase() })).toBe('synchronous');
  });

  it('uses the specified soft and hard timeout defaults', () => {
    expect(waitPolicyFor('navigation')).toMatchObject({ softTimeoutMs: 3_000, hardTimeoutMs: 8_000 });
    expect(waitPolicyFor('form_submit')).toMatchObject({ softTimeoutMs: 5_000, hardTimeoutMs: 15_000 });
    expect(waitPolicyFor('ai_generation')).toMatchObject({ softTimeoutMs: 10_000, hardTimeoutMs: 60_000 });
    expect(waitPolicyFor('file_processing')).toMatchObject({ softTimeoutMs: 15_000, hardTimeoutMs: 90_000 });
    expect(waitPolicyFor('unknown_async')).toMatchObject({ softTimeoutMs: 8_000, hardTimeoutMs: 30_000 });
  });

  it('charges Persona patience only for failed or unconfirmed stalled states', () => {
    expect(consumesPersonaAttempt(taskState('pending'), 'not_confirmed')).toBe(false);
    expect(consumesPersonaAttempt(taskState('progressing'), 'not_confirmed')).toBe(false);
    expect(consumesPersonaAttempt(taskState('failed'), 'inconclusive')).toBe(true);
    expect(consumesPersonaAttempt(taskState('stalled'), 'inconclusive')).toBe(false);
    expect(consumesPersonaAttempt(taskState('stalled'), 'not_confirmed')).toBe(true);
  });
});

describe.skipIf(process.env.EVALPILOT_BROWSER_TEST !== '1')('progress-aware browser waiting', () => {
  it('extends a progressing AI task and observes its eventual completion', async () => {
    const browser = await chromium.launch({ headless: true }); const page = await browser.newPage();
    await page.setContent('<main><button id="run">Generate report</button><div role="status">Ready</div></main><script>document.querySelector("#run").onclick=()=>{const s=document.querySelector("[role=status]");s.setAttribute("aria-busy","true");let n=0;const t=setInterval(()=>{n+=25;s.textContent=`Generating ${n}%`;if(n===100){clearInterval(t);s.removeAttribute("aria-busy");s.setAttribute("data-status","complete");s.textContent="Report ready"}},100)}</script>');
    const action = decision('Report ready'); action.expectedResult = 'Report ready';
    const before = await captureTaskStateSignals(page, action); await page.locator('#run').click();
    const result = await waitForProgressAwareOutcome({ page, before, decision: action, actionResult: { status: 'executed', action: 'click', targetElementId: 'E001', summary: 'clicked', evidenceRefs: [] }, operationType: 'ai_generation', policy: waitPolicyFor('ai_generation', { initialObservationMs: 50, pollIntervalMs: 100, softTimeoutMs: 180, hardTimeoutMs: 1_000, progressExtensionMs: 250, maxProgressExtensions: 3 }), stepIndex: 1, readRuntimeSignals: () => ({ activeRequests: 0, responseCount: 0, coreNetworkFailures: [], consoleErrors: [] }) });
    expect(result.taskState.state).toBe('completed');
    expect(result.taskWait.extensionsUsed).toBeGreaterThan(0);
    expect(result.taskWait.observations.some((item) => item.state === 'progressing')).toBe(true);
    expect(result.taskWait.observations.at(-1)?.completionSignals.length).toBeGreaterThan(0);
    await browser.close();
  });

  it('stalls a loading task without progress at the soft timeout', async () => {
    const browser = await chromium.launch({ headless: true }); const page = await browser.newPage();
    await page.setContent('<main><button id="run">Run task</button><div role="status">Ready</div></main><script>document.querySelector("#run").onclick=()=>{const s=document.querySelector("[role=status]");s.setAttribute("aria-busy","true");s.textContent="Loading"}</script>');
    const action = decision('Task complete'); const before = await captureTaskStateSignals(page, action); await page.locator('#run').click();
    const result = await waitForProgressAwareOutcome({ page, before, decision: action, actionResult: { status: 'executed', action: 'click', targetElementId: 'E001', summary: 'clicked', evidenceRefs: [] }, operationType: 'unknown_async', policy: waitPolicyFor('unknown_async', { initialObservationMs: 40, pollIntervalMs: 60, softTimeoutMs: 180, hardTimeoutMs: 700, progressExtensionMs: 200, maxProgressExtensions: 2 }), stepIndex: 1, readRuntimeSignals: () => ({ activeRequests: 0, responseCount: 0, coreNetworkFailures: [], consoleErrors: [] }) });
    expect(result.taskWait.observations.some((item) => item.state === 'pending')).toBe(true);
    expect(result.taskState.state).toBe('stalled');
    expect(result.taskWait).toMatchObject({ finalReason: 'soft_timeout', extensionsUsed: 1, consumedPersonaAttempt: false });
    await browser.close();
  });

  it('returns control after visible progress settles instead of burning the extended timeout', async () => {
    const browser = await chromium.launch({ headless: true }); const page = await browser.newPage();
    await page.setContent('<main><button id="run">Run panel</button><div role="status">Stage 0</div></main><script>document.querySelector("#run").onclick=()=>{const s=document.querySelector("[role=status]");s.textContent="Stage 1";setTimeout(()=>{s.textContent="Stage 2"},100)}</script>');
    const action = decision('Run panel'); action.expectedResult = 'Never terminal marker';
    const before = await captureTaskStateSignals(page, action); await page.locator('#run').click();
    const startedAt = performance.now();
    const result = await waitForProgressAwareOutcome({ page, before, decision: action, actionResult: { status: 'executed', action: 'click', targetElementId: 'E001', summary: 'clicked', evidenceRefs: [] }, operationType: 'unknown_async', policy: waitPolicyFor('unknown_async', { initialObservationMs: 40, pollIntervalMs: 50, softTimeoutMs: 180, hardTimeoutMs: 900, progressExtensionMs: 500, maxProgressExtensions: 2 }), stepIndex: 1, readRuntimeSignals: () => ({ activeRequests: 0, responseCount: 0, coreNetworkFailures: [], consoleErrors: [] }) });
    const elapsedMs = performance.now() - startedAt;
    expect(result.taskWait.observations.some((item) => item.state === 'progressing')).toBe(true);
    expect(result.taskState.state).toBe('interacting');
    expect(result.taskWait.finalReason).toBe('not_needed');
    expect(result.summary).toContain('已经稳定');
    expect(elapsedMs).toBeLessThan(650);
    await browser.close();
  });
});