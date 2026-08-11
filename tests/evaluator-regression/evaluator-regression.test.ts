import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';
import type { CandidateFinding, EvalCase, EvalCaseResult, EvidencePacket, TaskStateObservation, UxIssue } from '../../types.js';
import { createFixTask } from '../../src/agents/fix-service.js';
import { decideEvaluationNextAction } from '../../src/decision/next-action-engine.js';
import type { EvaluationDecisionInput } from '../../src/decision/types.js';
import { registerProject } from '../../src/projects/project-service.js';
import { captureTaskStateSignals } from '../../src/test-agent/task-state-signals.js';
import { consumesPersonaAttempt, waitForProgressAwareOutcome, waitPolicyFor, type ProgressAwareWaitResult } from '../../src/test-agent/progress-aware-wait.js';
import { evaluatorRegressionFixtures, fixtureById, regressionTimeScale } from './fixtures.js';

const now = '2026-08-11T08:00:00.000Z';
const action = { decisionId: 'decision-regression', intentSummary: '生成结果', action: 'click' as const, targetElementId: 'E001', value: null, expectedResult: 'Result ready', confidence: 1 };
const actionResult = { status: 'executed' as const, action: 'click' as const, targetElementId: 'E001', summary: 'clicked', evidenceRefs: [] };
const runtimeSignals = () => ({ activeRequests: 0, responseCount: 0, coreNetworkFailures: [], consoleErrors: [] });

afterEach(() => { delete process.env.EVALPILOT_DATA_DIR; });

function scaled(ms: number): number { return Math.max(1, Math.round(ms * regressionTimeScale)); }

async function runPageWait(page: Page, html: string, policy: Parameters<typeof waitPolicyFor>[1]): Promise<ProgressAwareWaitResult> {
  await page.setContent(html);
  const before = await captureTaskStateSignals(page, action);
  await page.locator('#run').click();
  return waitForProgressAwareOutcome({ page, before, decision: action, actionResult, operationType: 'ai_generation', policy: waitPolicyFor('ai_generation', policy), stepIndex: 1, readRuntimeSignals: runtimeSignals });
}

async function withPage<T>(work: (page: Page) => Promise<T>): Promise<T> {
  const browser = await chromium.launch({ headless: true });
  try { return await work(await browser.newPage()); } finally { await browser.close(); }
}

function slowHtml(durationMs: number): string {
  return `<main><button id="run">Generate</button><div role="status">Ready</div></main><script>document.querySelector('#run').onclick=()=>{const s=document.querySelector('[role=status]');s.setAttribute('aria-busy','true');s.textContent='Processing';setTimeout(()=>{s.removeAttribute('aria-busy');s.setAttribute('data-status','complete');s.textContent='Result ready'},${scaled(durationMs)})}</script>`;
}

function streamingHtml(durationMs: number): string {
  const interval = scaled(2_000); const steps = Math.round(durationMs / 2_000);
  return `<main><button id="run">Generate</button><div role="status">Ready</div></main><script>document.querySelector('#run').onclick=()=>{const s=document.querySelector('[role=status]');s.setAttribute('aria-busy','true');let n=0;const t=setInterval(()=>{n+=1;s.textContent='Generating '+n+' / ${steps}';if(n===${steps}){clearInterval(t);s.removeAttribute('aria-busy');s.setAttribute('data-status','complete');s.textContent='Result ready'}},${interval})}</script>`;
}

function evalCase(id = 'case-regression'): EvalCase {
  return { caseId: id, projectId: 'project-regression', setType: 'baseline', status: 'stable', origin: { type: 'human', note: 'phase 9 badcase' }, capabilityId: 'cap-regression', taskId: null, title: '生成结果', hypothesis: '任务可完成', persona: { personaId: 'persona-low', name: '低耐心用户', patienceTurns: 1, retryTolerance: 0, behaviorPolicy: ['只等待可见进展'] }, goal: '生成结果', knownInformation: {}, preconditions: [], oracle: { expectedOutcome: ['Result ready'], mustObserve: [], mustNotObserve: [], businessRules: [], semanticRubric: [], deterministicAssertions: [], inconclusiveWhen: ['仍在处理'] }, coverageDimensions: [], riskLevel: 'P1', generationReason: 'phase 9 fixture', version: 1, stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 0, lastExecutedAt: null }, regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: now, updatedAt: now };
}

function result(verdict: EvalCaseResult['verdict'], failureSource: EvalCaseResult['failureSource']): EvalCaseResult {
  return { runId: 'run-regression', caseId: 'case-regression', verdict, failureSource, severity: verdict === 'fail' ? 'P1' : null, deterministic: { checks: [], hardFailure: verdict === 'fail' && failureSource === 'product', severity: verdict === 'fail' ? 'P1' : null, evidenceRefs: [] }, semantic: { verdict, taskCompletion: verdict === 'pass' ? 'complete' : 'unknown', summary: 'fixture', whatWorked: [], whatFailed: [], whyItMatters: [], confirmedFacts: [], hypotheses: [], unknowns: verdict === 'inconclusive' ? ['评测器没有完成'] : [], evidenceRefs: [], confidence: 1 }, evidencePacketPath: 'runs/run-regression/evidence-packet.json', createdAt: now };
}

function finding(): CandidateFinding {
  return { findingId: 'finding-confirmed', projectId: 'project-regression', caseId: 'case-regression', runId: 'run-regression', title: '保存没有生效', summary: '确定性证据确认保存失败', status: 'confirmed_product_failure', semanticConfidence: 1, deterministicSupport: true, independentEvidenceTypes: ['dom', 'network'], confirmedFacts: ['保存请求失败'], hypotheses: [], unknowns: [], evidenceRefs: ['network.jsonl'], createdAt: now, updatedAt: now };
}

function input(overrides: Partial<EvaluationDecisionInput> = {}): EvaluationDecisionInput {
  return { evaluationId: 'evaluation-regression', evaluationStatus: 'completed', selectedCases: [evalCase()], results: [result('pass', null)], findings: [], badcases: [], fixTasks: [], evidencePackets: [], ...overrides };
}

function pendingPacket(taskState: TaskStateObservation): EvidencePacket {
  return { runId: 'run-regression', caseId: 'case-regression', targetAppCommit: null, actorModel: 'mock', actorPromptVersion: '1', startedAt: now, completedAt: now, actions: [], observations: [], stepVerifications: [], stepEvidence: [{ stepIndex: 1, beforeObservationId: 'before', afterObservationId: 'after', beforeScreenshotPath: 'before.png', afterScreenshotPath: 'after.png', decisionId: action.decisionId, verificationId: 'verify', actionStatus: 'executed', taskState, taskWait: null }], screenshots: [], tracePath: null, evidenceCompleteness: { complete: false, hasInitialObservation: true, hasFinalObservation: false, hasBeforeAfterScreenshots: true, hasStepVerifications: false, hasTrace: false, missing: ['任务尚未完成'] }, consoleEvidence: [], networkEvidence: [], finalState: { url: 'http://127.0.0.1/', visibleTextSummary: 'Processing' }, versions: { targetAppGitSha: null, productModelVersion: 1, evalSetVersion: 1, caseVersion: 1, evalPilotVersion: 'test', actorModel: 'mock', judgeModel: 'mock', actorPromptVersion: '1', judgePromptVersion: '1', toolSchemaVersion: '1', timestamp: now } };
}

function uxIssue(userGoal: string, failure: string): UxIssue {
  return { issueId: 'shared-issue', type: 'journey_breakpoint', severity: 'P1', featureId: 'cap-1', personaId: 'persona-1', caseId: 'case-1', userGoal, idealPath: ['进入', '完成'], actualPath: ['进入', failure], shortestReasonablePath: ['进入', '完成'], failureOrAbandonmentPoint: failure, metrics: { metricType: 'simulated_user_run', timeToFirstActionMs: 1, timeToFindEntryMs: 1, timeToFirstMeaningfulActionMs: 1, timeToCompleteMs: null, totalActions: 1, requiredActions: 2, redundantActions: 0, clickCount: 1, inputCount: 0, pageTransitions: 0, backtrackCount: 0, retryCount: 0, repeatedInputCount: 0, deadClickCount: 0, clarificationCount: 0, deadEndCount: 1, errorCount: 0, recoveryAttempts: 0, recoverySuccess: false, taskCompleted: false, fullLoopCompleted: false, abandoned: true, abandonmentReason: failure, finalConfidence: 'high' }, evidence: [], recommendation: '补充结果反馈', protectedSafetySteps: [], confidence: 'high', needsHumanReview: true, addedToRegression: false };
}

async function snapshotFixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'evalpilot-phase9-snapshot-')); process.env.EVALPILOT_DATA_DIR = resolve(cwd, '.data');
  const target = resolve(cwd, 'target'); await mkdir(target); await writeFile(resolve(target, 'package.json'), '{"name":"phase9-target"}');
  const project = await registerProject(cwd, { projectRoot: target, targetUrl: 'http://localhost:3997' });
  const evaluationA = resolve(project.outputDir, 'evaluations', 'evaluation-a'); const evaluationB = resolve(project.outputDir, 'evaluations', 'evaluation-b'); const reports = resolve(project.outputDir, 'reports');
  await mkdir(evaluationA, { recursive: true }); await mkdir(evaluationB, { recursive: true }); await mkdir(reports, { recursive: true });
  const issueA = uxIssue('提交评测 A 的表单', '评测 A 提交后没有结果'); const issueB = uxIssue('提交评测 B 的表单', '评测 B 的按钮被禁用');
  await writeFile(resolve(evaluationA, 'issues.jsonl'), `${JSON.stringify(issueA)}\n`); await writeFile(resolve(evaluationB, 'issues.jsonl'), `${JSON.stringify(issueB)}\n`); await writeFile(resolve(reports, 'ux-issues.jsonl'), `${JSON.stringify(issueB)}\n`);
  return { cwd, project, evaluationA, reports, issueA, issueB };
}

describe('Phase 9 evaluator regression fixture inventory', () => {
  it('contains the ten named historical badcases exactly once', () => {
    expect(evaluatorRegressionFixtures).toHaveLength(10);
    expect(new Set(evaluatorRegressionFixtures.map((item) => item.id)).size).toBe(10);
  });
});

describe.skipIf(process.env.EVALPILOT_BROWSER_TEST !== '1')('Phase 9 evaluator browser regressions', () => {
  it('slow-ai-generation-10s', async () => withPage(async (page) => {
    const fixture = fixtureById('slow-ai-generation-10s');
    expect(waitPolicyFor('ai_generation')).toMatchObject({ softTimeoutMs: 10_000, hardTimeoutMs: 60_000 });
    const waited = await runPageWait(page, slowHtml(fixture.productionDurationMs!), { initialObservationMs: scaled(500), pollIntervalMs: scaled(1_000), softTimeoutMs: scaled(13_000), hardTimeoutMs: scaled(30_000), progressExtensionMs: scaled(5_000), maxProgressExtensions: 4 });
    expect(waited.taskState.state).toBe('completed');
    expect(waited.taskWait.observations.filter((item) => item.state !== 'completed').every((item) => !consumesPersonaAttempt(item, 'inconclusive'))).toBe(true);
  }));

  it('streaming-output-20s', async () => withPage(async (page) => {
    const fixture = fixtureById('streaming-output-20s');
    const waited = await runPageWait(page, streamingHtml(fixture.productionDurationMs!), { initialObservationMs: scaled(500), pollIntervalMs: scaled(1_000), softTimeoutMs: scaled(5_000), hardTimeoutMs: scaled(35_000), progressExtensionMs: scaled(6_000), maxProgressExtensions: 5 });
    expect(waited.taskState.state).toBe('completed'); expect(waited.taskWait.extensionsUsed).toBeGreaterThan(0);
    expect(waited.taskWait.observations.some((item) => item.state === 'progressing')).toBe(true);
  }));

  it('loading-with-no-new-button', async () => withPage(async (page) => {
    const waited = await runPageWait(page, slowHtml(5_000), { initialObservationMs: scaled(500), pollIntervalMs: scaled(1_000), softTimeoutMs: scaled(8_000), hardTimeoutMs: scaled(15_000), progressExtensionMs: scaled(4_000), maxProgressExtensions: 2 });
    const pending = waited.taskWait.observations.find((item) => item.state === 'pending');
    expect(pending).toBeDefined();
    expect(decideEvaluationNextAction(input({ evaluationStatus: 'running', results: [], evidencePackets: [pendingPacket(pending!)] }))).toMatchObject({ type: 'wait_and_resume' });
  }));

  it('stalled-generation', async () => withPage(async (page) => {
    const html = `<main><button id="run">Generate</button><div role="status">Ready</div></main><script>document.querySelector('#run').onclick=()=>{const s=document.querySelector('[role=status]');s.setAttribute('aria-busy','true');s.textContent='Processing'}</script>`;
    const waited = await runPageWait(page, html, { initialObservationMs: scaled(500), pollIntervalMs: scaled(1_000), softTimeoutMs: scaled(5_000), hardTimeoutMs: scaled(12_000), progressExtensionMs: scaled(2_000), maxProgressExtensions: 1 });
    expect(waited.taskWait.observations.some((item) => item.state === 'pending')).toBe(true); expect(waited.taskState.state).toBe('stalled');
    expect(consumesPersonaAttempt(waited.taskState, 'inconclusive')).toBe(false);
    expect(decideEvaluationNextAction(input({ results: [result('inconclusive', 'evaluator')] }))).toMatchObject({ type: 'rerun_case', primaryCta: { label: '重新评测' } });
  }));

  it('pending-does-not-consume-persona', async () => withPage(async (page) => {
    const fixture = fixtureById('pending-does-not-consume-persona');
    const waited = await runPageWait(page, slowHtml(fixture.productionDurationMs!), { initialObservationMs: scaled(500), pollIntervalMs: scaled(1_000), softTimeoutMs: scaled(18_000), hardTimeoutMs: scaled(30_000), progressExtensionMs: scaled(5_000), maxProgressExtensions: 3 });
    const failedAttempts = waited.taskWait.observations.reduce((count, state) => count + Number(consumesPersonaAttempt(state, 'inconclusive')), 0);
    expect(waited.taskState.state).toBe('completed'); expect(failedAttempts).toBe(0);
  }));

  it('progress-resets-stall-clock', async () => withPage(async (page) => {
    const fixture = fixtureById('progress-resets-stall-clock');
    const waited = await runPageWait(page, streamingHtml(fixture.productionDurationMs!), { initialObservationMs: scaled(500), pollIntervalMs: scaled(1_000), softTimeoutMs: scaled(5_000), hardTimeoutMs: scaled(35_000), progressExtensionMs: scaled(6_000), maxProgressExtensions: 5 });
    const progressTimes = waited.taskWait.observations.filter((item) => item.state === 'progressing').map((item) => item.lastProgressAtMs).filter((value): value is number => value !== null);
    expect(progressTimes.length).toBeGreaterThan(2); expect(progressTimes.every((value, index) => index === 0 || value > progressTimes[index - 1]!)).toBe(true);
    expect(waited.taskWait.observations.slice(0, -1).some((item) => item.state === 'stalled')).toBe(false); expect(waited.taskState.state).toBe('completed');
  }));
});

describe('Phase 9 evaluator lineage and next-action regressions', () => {
  it('issue-snapshot-fix-handoff', async () => {
    const fixture = await snapshotFixture();
    const task = await createFixTask(fixture.cwd, { projectId: fixture.project.projectId, evaluationId: 'evaluation-a', issueId: 'shared-issue', confirmed: true });
    await writeFile(resolve(fixture.evaluationA, 'issues.jsonl'), `${JSON.stringify(fixture.issueB)}\n`);
    const snapshot = JSON.parse(await readFile(task.sourceSnapshotPath, 'utf8'));
    expect(snapshot).toMatchObject({ evaluationId: 'evaluation-a', payload: { userGoal: '提交评测 A 的表单', failureOrAbandonmentPoint: '评测 A 提交后没有结果' } });
  });

  it('stale-global-issue-file', async () => {
    const fixture = await snapshotFixture();
    const task = await createFixTask(fixture.cwd, { projectId: fixture.project.projectId, evaluationId: 'evaluation-a', issueId: 'shared-issue', confirmed: true });
    const before = await readFile(task.sourceSnapshotPath, 'utf8');
    await writeFile(resolve(fixture.reports, 'ux-issues.jsonl'), `${JSON.stringify(uxIssue('后来生成的全局报告', '全局报告已变化'))}\n`);
    expect(await readFile(task.sourceSnapshotPath, 'utf8')).toBe(before); expect(await readFile(resolve(task.taskDirectory, 'task.md'), 'utf8')).toContain('提交评测 A 的表单');
  });

  it('no-product-bug-next-action', () => {
    expect(decideEvaluationNextAction(input({ results: [result('inconclusive', 'evaluator')] }))).toMatchObject({ type: 'rerun_case', primaryCta: { label: '重新评测' } });
  });

  it('confirmed-product-bug-next-action', () => {
    expect(decideEvaluationNextAction(input({ results: [result('fail', 'product')], findings: [finding()] }))).toMatchObject({ type: 'create_fix_task', primaryCta: { label: '生成 Codex 修复任务' } });
  });
});
