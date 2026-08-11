import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { promisify } from 'node:util';
import { applyFix, createFixTask, listAgentRuns, startAgent } from '../src/agents/fix-service.js';
import { loadProjectRegistry } from '../src/projects/project-registry.js';
import { registerProject, startProject } from '../src/projects/project-service.js';
import { startDashboardServer } from '../src/dashboard/server.js';
import { evaluationDepthOptions, evaluationSnapshot, listEvaluationRecords, renameEvaluation, retryEvaluation, startEvaluation } from '../src/dashboard/evaluation-manager.js';
import { saveFinding } from '../src/findings/finding-store.js';

const closers: Array<() => Promise<void>> = [];
const exec = promisify(execFile);
afterEach(async () => { delete process.env.EVALPILOT_DATA_DIR; delete process.env.EVALPILOT_OPENAI_API_KEY; while (closers.length) await closers.pop()?.(); });

function useFixtureDataDir(cwd: string): void {
  process.env.EVALPILOT_DATA_DIR = resolve(cwd, '.evalpilot-data');
}

async function unusedPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('没有取得测试端口'));
      server.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

function uxIssue(issueId: string, userGoal: string, failure: string) {
  return {
    issueId, type: 'journey_breakpoint', severity: 'P1', featureId: 'cap-1', personaId: 'persona-1', caseId: 'case-1', userGoal,
    idealPath: ['进入', '完成'], actualPath: ['进入', failure], shortestReasonablePath: ['进入', '完成'], failureOrAbandonmentPoint: failure,
    metrics: { metricType: 'simulated_user_run', timeToFirstActionMs: 1, timeToFindEntryMs: 1, timeToFirstMeaningfulActionMs: 1, timeToCompleteMs: null, totalActions: 1, requiredActions: 2, redundantActions: 0, clickCount: 1, inputCount: 0, pageTransitions: 0, backtrackCount: 0, retryCount: 0, repeatedInputCount: 0, deadClickCount: 0, clarificationCount: 0, deadEndCount: 1, errorCount: 0, recoveryAttempts: 0, recoverySuccess: false, taskCompleted: false, fullLoopCompleted: false, abandoned: true, abandonmentReason: failure, finalConfidence: 'high' },
    evidence: [], recommendation: '补充结果反馈', protectedSafetySteps: [], confidence: 'high', needsHumanReview: true, addedToRegression: false,
  };
}

describe('multi-project workspace', () => {
  it('does not create a default evaluation without a configured AI provider', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evalpilot-provider-required-')); const target = resolve(cwd, 'target'); await mkdir(target);
    useFixtureDataDir(cwd);
    await writeFile(resolve(target, 'package.json'), JSON.stringify({ name: 'provider-fixture' }));
    const project = await registerProject(cwd, { projectRoot: target, targetUrl: 'http://127.0.0.1:9' });
    await expect(startEvaluation(cwd, { projectId: project.projectId, depth: 'core', capabilityIds: [], allowRemoteModel: true, allowScreenshot: false })).rejects.toMatchObject({ code: 'AI_PROVIDER_NOT_CONFIGURED' });
  });

  it('registers two projects with isolated output directories and switches active project', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evalpilot-workspace-'));
    useFixtureDataDir(cwd);
    const first = resolve(cwd, 'first'); const second = resolve(cwd, 'second');
    await mkdir(first); await mkdir(second);
    await writeFile(resolve(first, 'package.json'), JSON.stringify({ name: 'first', scripts: { dev: 'vite' } }));
    await writeFile(resolve(second, 'package.json'), JSON.stringify({ name: 'second', scripts: { start: 'node index.js' } }));
    const a = await registerProject(cwd, { projectRoot: first, targetUrl: 'http://localhost:3101' });
    const b = await registerProject(cwd, { projectRoot: second, targetUrl: 'http://localhost:3102' });
    const registry = await loadProjectRegistry(cwd);
    expect(registry.projects).toHaveLength(2);
    expect(registry.activeProjectId).toBe(b.projectId);
    expect(a.outputDir).not.toBe(b.outputDir);
    expect(a.startCommand).toBe('npm run dev');
    expect(b.startCommand).toBe('npm run start');
  });

  it.skipIf(process.env.EVALPILOT_DASHBOARD_TEST !== '1')('starts a Vite project on the exact confirmed test URL', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evalpilot-vite-start-')); const target = resolve(cwd, 'vite-target'); await mkdir(target);
    useFixtureDataDir(cwd);
    const port = await unusedPort();
    await writeFile(resolve(target, 'package.json'), JSON.stringify({ name: 'vite-target', scripts: { dev: 'node server.mjs vite' } }));
    await writeFile(resolve(target, 'server.mjs'), `import { createServer } from 'node:http';\nconst value = (name) => process.argv[process.argv.indexOf(name) + 1];\nconst server = createServer((_request, response) => { response.end('<title>vite-target</title>'); setTimeout(() => server.close(), 50); });\nserver.listen(Number(value('--port')), value('--host'));\n`);
    const project = await registerProject(cwd, { projectRoot: target, targetUrl: `http://127.0.0.1:${port}` });

    const readiness = await startProject(cwd, project.projectId);

    expect(readiness).toEqual(expect.objectContaining({ targetUrl: `http://127.0.0.1:${port}`, port, urlReachable: true, targetVerified: true, canEvaluate: true }));
  });

  it.skipIf(process.env.EVALPILOT_DASHBOARD_TEST !== '1')('falls back to the next port only when automatic recovery is enabled', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evalpilot-port-'));
    const assets = resolve(cwd, 'assets'); await mkdir(assets); await writeFile(resolve(assets, 'index.html'), 'ok');
    const first = await startDashboardServer(cwd, 0, assets); closers.push(first.close);
    const second = await startDashboardServer(cwd, first.port, assets, true); closers.push(second.close);
    expect(second.port).toBeGreaterThan(first.port);
  });

  it('creates a portable fix package without changing the target project', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evalpilot-fix-package-'));
    useFixtureDataDir(cwd);
    const target = resolve(cwd, 'target'); await mkdir(target);
    await writeFile(resolve(target, 'package.json'), JSON.stringify({ name: 'target', scripts: { test: 'node --test' } }));
    await writeFile(resolve(target, 'index.js'), 'export const value = 1;\n');
    await exec('git', ['init'], { cwd: target });
    await exec('git', ['add', '.'], { cwd: target });
    await exec('git', ['-c', 'user.name=EvalPilot Test', '-c', 'user.email=evalpilot@example.invalid', 'commit', '-m', 'fixture'], { cwd: target });
    const project = await registerProject(cwd, { projectRoot: target, targetUrl: 'http://localhost:3999' });
    await mkdir(resolve(project.outputDir, 'evaluations', 'evaluation-fix'), { recursive: true });
    await writeFile(resolve(project.outputDir, 'evaluations', 'evaluation-fix', 'issues.jsonl'), `${JSON.stringify(uxIssue('ux-fix-1', '完成核心任务', '提交后没有结果'))}\n`);
    const task = await createFixTask(cwd, { projectId: project.projectId, evaluationId: 'evaluation-fix', issueId: 'ux-fix-1', confirmed: true });
    const run = await startAgent(cwd, task.fixTaskId, { confirmed: true, adapter: 'task_package' });
    const codexRun = await startAgent(cwd, task.fixTaskId, { confirmed: true, adapter: 'codex' });
    expect(run.status).toBe('completed');
    const claudeRun = await startAgent(cwd, task.fixTaskId, { confirmed: true, adapter: 'claude_code' });
    const antigravityRun = await startAgent(cwd, task.fixTaskId, { confirmed: true, adapter: 'antigravity' });
    expect(codexRun).toEqual(expect.objectContaining({ adapter: 'codex', executionMode: 'handoff', worktreePath: null }));
    expect(claudeRun).toEqual(expect.objectContaining({ adapter: 'claude_code', executionMode: 'handoff', worktreePath: null }));
    expect(antigravityRun).toEqual(expect.objectContaining({ adapter: 'antigravity', executionMode: 'handoff', worktreePath: null }));
    expect((await listAgentRuns(cwd, task.fixTaskId)).map((item) => item.agentRunId)).toEqual(expect.arrayContaining([run.agentRunId, codexRun.agentRunId, claudeRun.agentRunId, antigravityRun.agentRunId]));
    await expect(applyFix(cwd, task.fixTaskId, { confirmed: true })).rejects.toMatchObject({ code: 'FIX_APPLY_INVALID' });
    await expect(readFile(resolve(task.taskDirectory, 'task.md'), 'utf8')).resolves.toContain('完成核心任务');
    await expect(readFile(resolve(task.taskDirectory, 'task.json'), 'utf8')).resolves.toContain('baselineCommit');
    await expect(readFile(resolve(task.taskDirectory, 'source-snapshot.json'), 'utf8')).resolves.toContain('evaluation-fix');
    await expect(readFile(run.logFile.replace(/\.log$/, '.json'), 'utf8')).resolves.toContain('task_package');
    expect((await exec('git', ['status', '--short'], { cwd: target })).stdout.trim()).toBe('');
  });

  it('keeps a fix task bound to the issue snapshot from the selected evaluation', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evalpilot-fix-snapshot-')); useFixtureDataDir(cwd);
    const target = resolve(cwd, 'target'); await mkdir(target); await writeFile(resolve(target, 'package.json'), JSON.stringify({ name: 'snapshot-target' }));
    const project = await registerProject(cwd, { projectRoot: target, targetUrl: 'http://localhost:3997' });
    const evaluationA = resolve(project.outputDir, 'evaluations', 'evaluation-a'); const evaluationB = resolve(project.outputDir, 'evaluations', 'evaluation-b'); const reports = resolve(project.outputDir, 'reports');
    await mkdir(evaluationA, { recursive: true }); await mkdir(evaluationB, { recursive: true }); await mkdir(reports, { recursive: true });
    const issueA = uxIssue('shared-issue', '提交评测 A 的表单', '评测 A 提交后没有结果'); const issueB = uxIssue('shared-issue', '提交评测 B 的表单', '评测 B 的按钮被禁用');
    await writeFile(resolve(evaluationA, 'issues.jsonl'), `${JSON.stringify(issueA)}\n`); await writeFile(resolve(evaluationB, 'issues.jsonl'), `${JSON.stringify(issueB)}\n`); await writeFile(resolve(reports, 'ux-issues.jsonl'), `${JSON.stringify(issueB)}\n`);

    await expect(createFixTask(cwd, { projectId: project.projectId, issueId: 'shared-issue', confirmed: true })).rejects.toMatchObject({ code: 'FIX_TASK_INVALID' });
    const task = await createFixTask(cwd, { projectId: project.projectId, evaluationId: 'evaluation-a', issueId: 'shared-issue', confirmed: true });
    await writeFile(resolve(evaluationA, 'issues.jsonl'), `${JSON.stringify(issueB)}\n`); await writeFile(resolve(reports, 'ux-issues.jsonl'), `${JSON.stringify(uxIssue('shared-issue', '后来生成的全局报告', '全局报告已变化'))}\n`);

    const snapshot = JSON.parse(await readFile(task.sourceSnapshotPath, 'utf8'));
    expect(snapshot).toEqual(expect.objectContaining({ sourceType: 'evaluation_issue', evaluationId: 'evaluation-a', issueId: 'shared-issue', payload: expect.objectContaining({ userGoal: '提交评测 A 的表单', failureOrAbandonmentPoint: '评测 A 提交后没有结果' }) }));
    await expect(readFile(resolve(task.taskDirectory, 'task.md'), 'utf8')).resolves.toContain('提交评测 A 的表单');
    const run = await startAgent(cwd, task.fixTaskId, { confirmed: true, adapter: 'task_package' });
    expect(run.status).toBe('completed');
  });

  it('creates an immutable fix source only from a confirmed adaptive finding', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evalpilot-finding-fix-')); useFixtureDataDir(cwd);
    const target = resolve(cwd, 'target'); await mkdir(target); await writeFile(resolve(target, 'package.json'), JSON.stringify({ name: 'finding-target' }));
    const project = await registerProject(cwd, { projectRoot: target, targetUrl: 'http://localhost:3996' }); const now = new Date().toISOString();
    const finding = { findingId: 'finding-fix-1', projectId: project.projectId, caseId: 'case-adaptive-1', runId: 'run-adaptive-1', title: '提交后没有结果', summary: '用户提交后仍停留在原页面。', status: 'candidate' as const, semanticConfidence: 0.9, deterministicSupport: false, independentEvidenceTypes: ['screenshot', 'network'], confirmedFacts: ['提交动作已执行', '页面没有显示结果'], hypotheses: [], unknowns: ['服务端是否收到请求'], evidenceRefs: ['runs/run-adaptive-1/step-001-after.png'], createdAt: now, updatedAt: now };
    await saveFinding(project.outputDir, finding);
    await expect(createFixTask(cwd, { projectId: project.projectId, findingId: finding.findingId, confirmed: true })).rejects.toMatchObject({ code: 'FINDING_NOT_CONFIRMED' });
    await saveFinding(project.outputDir, { ...finding, status: 'confirmed_product_failure', updatedAt: new Date(Date.now() + 1_000).toISOString() });
    const task = await createFixTask(cwd, { projectId: project.projectId, findingId: finding.findingId, confirmed: true });
    await saveFinding(project.outputDir, { ...finding, title: '后来修改的标题', summary: '后来修改的说明', status: 'confirmed_product_failure', updatedAt: new Date(Date.now() + 2_000).toISOString() });

    const snapshot = JSON.parse(await readFile(task.sourceSnapshotPath, 'utf8'));
    expect(snapshot).toEqual(expect.objectContaining({ sourceType: 'confirmed_finding', findingId: finding.findingId, payload: expect.objectContaining({ title: '提交后没有结果', summary: '用户提交后仍停留在原页面。' }) }));
    expect(task).toEqual(expect.objectContaining({ evaluationId: null, issueId: null, findingId: finding.findingId, retestCaseId: 'case-adaptive-1' }));
  });

  it('persists a failed evaluation and exposes an explicit recovery path', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evalpilot-retry-')); const target = resolve(cwd, 'target'); await mkdir(target);
    useFixtureDataDir(cwd);
    await writeFile(resolve(target, 'package.json'), JSON.stringify({ name: 'retry-fixture', scripts: { dev: 'vite' } }));
    const project = await registerProject(cwd, { projectRoot: target, targetUrl: 'http://127.0.0.1:9' });
    process.env.EVALPILOT_OPENAI_API_KEY = 'test-only-key';
    const started = await startEvaluation(cwd, { projectId: project.projectId, depth: 'core', capabilityIds: [], allowRemoteModel: true, allowScreenshot: false });
    for (let index = 0; index < 40 && evaluationSnapshot(started.evaluationId)?.session.status !== 'failed'; index += 1) await new Promise((wait) => setTimeout(wait, 25));
    expect(evaluationSnapshot(started.evaluationId)?.session.currentStage).toBe('readiness');
    expect(evaluationSnapshot(started.evaluationId)?.session.status).toBe('failed');
    const resumed = await retryEvaluation(cwd, started.evaluationId);
    expect(['queued', 'running']).toContain(resumed.status);
    for (let index = 0; index < 40 && evaluationSnapshot(started.evaluationId)?.session.status !== 'failed'; index += 1) await new Promise((wait) => setTimeout(wait, 25));
    expect(evaluationSnapshot(started.evaluationId)?.session.error).toContain('测试网址尚未启动');
  });

  it('keeps failed Legacy evaluations read-only instead of retrying without current AI consent', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evalpilot-legacy-retry-')); const target = resolve(cwd, 'target'); await mkdir(target);
    useFixtureDataDir(cwd);
    await writeFile(resolve(target, 'package.json'), JSON.stringify({ name: 'legacy-retry-fixture' }));
    const project = await registerProject(cwd, { projectRoot: target, targetUrl: 'http://127.0.0.1:9' });
    await mkdir(resolve(project.outputDir, 'evaluations'), { recursive: true });
    const legacySession = { evaluationId: 'evaluation-legacy-failed', projectId: project.projectId, sequenceNumber: 1, depth: 'core', capabilityIds: [], capabilityNames: [], customName: null, competitorSnapshotIds: [], issueIds: [], status: 'failed', currentStage: 'run', stages: [{ name: 'run', status: 'failed', message: 'legacy failed' }], runIds: [], startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), error: 'legacy failed' };
    const sessionsPath = resolve(project.outputDir, 'evaluations', 'sessions.jsonl');
    const rawLegacySession = `${JSON.stringify(legacySession)}\n`;
    await writeFile(sessionsPath, rawLegacySession);

    await expect(retryEvaluation(cwd, legacySession.evaluationId)).rejects.toMatchObject({ code: 'LEGACY_EVALUATION_READ_ONLY' });
    expect(await readFile(sessionsPath, 'utf8')).toBe(rawLegacySession);
  });

  it('returns understandable depth options and semantic evaluation records', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evalpilot-records-')); const target = resolve(cwd, 'target'); await mkdir(target);
    useFixtureDataDir(cwd);
    await writeFile(resolve(target, 'package.json'), JSON.stringify({ name: 'records-fixture' }));
    const project = await registerProject(cwd, { projectRoot: target, targetUrl: 'http://localhost:3998' });
    await mkdir(resolve(project.outputDir, 'evaluations', 'evaluation-1'), { recursive: true });
    await writeFile(resolve(project.outputDir, 'scenarios.jsonl'), `${JSON.stringify({ caseId: 'fixed-1', capability: 'cap-a', automationStatus: 'automated' })}\n`);
    await writeFile(resolve(project.outputDir, 'exploratory-scenarios.jsonl'), `${JSON.stringify({ caseId: 'explore-1', capability: 'cap-a' })}\n`);
    const startedAt = new Date(Date.now() - 120_000).toISOString(); const completedAt = new Date().toISOString();
    const coverage = { discoveredCount: 2, plannedCount: 2, browserVisitedCount: 1, executedCount: 1, passedCount: 1, failedCount: 0, blockedCount: 0, notApplicableCount: 0, notRunCount: 1, complete: false, capabilities: [{ capabilityId: 'cap-a', capabilityName: '功能 A', entryPoint: '/a', discovered: true, browserVisited: true, executionStatus: 'passed', runIds: ['run-a'], reason: '用户任务和完整闭环已通过' }, { capabilityId: 'cap-b', capabilityName: '功能 B', entryPoint: '/b', discovered: true, browserVisited: false, executionStatus: 'not_run', runIds: [], reason: '等待执行' }] };
    const legacySession = { evaluationId: 'evaluation-1', projectId: project.projectId, sequenceNumber: 1, depth: 'core', capabilityIds: ['cap-a'], capabilityNames: ['功能 A'], customName: null, competitorSnapshotIds: [], issueIds: ['issue-1'], status: 'completed', currentStage: 'report', stages: [], runIds: [], startedAt, completedAt, error: null };
    const coveredSession = { ...legacySession, evaluationId: 'evaluation-2', sequenceNumber: 2, capabilityIds: ['cap-a', 'cap-b'], capabilityNames: ['功能 A'], plannedCapabilityIds: ['cap-a', 'cap-b'], plannedCapabilityNames: ['功能 A', '功能 B'], executedCapabilityIds: ['cap-a'], executedCapabilityNames: ['功能 A'], coverage, issueIds: [], startedAt: new Date(Date.now() - 60_000).toISOString() };
    const passedCoverage = { ...coverage, browserVisitedCount: 2, executedCount: 2, passedCount: 2, notRunCount: 0, complete: true, capabilities: coverage.capabilities.map((item) => ({ ...item, browserVisited: true, executionStatus: 'passed', runIds: [`run-${item.capabilityId}`], reason: '用户任务和完整闭环已通过' })) };
    const passedSession = { ...coveredSession, evaluationId: 'evaluation-3', sequenceNumber: 3, capabilityNames: ['功能 A', '功能 B'], executedCapabilityIds: ['cap-a', 'cap-b'], executedCapabilityNames: ['功能 A', '功能 B'], coverage: passedCoverage, startedAt: new Date(Date.now() - 30_000).toISOString() };
    await mkdir(resolve(project.outputDir, 'evaluations', 'evaluation-2'), { recursive: true }); await mkdir(resolve(project.outputDir, 'evaluations', 'evaluation-3'), { recursive: true });
    await writeFile(resolve(project.outputDir, 'evaluations', 'sessions.jsonl'), `${JSON.stringify(legacySession)}\n${JSON.stringify(coveredSession)}\n${JSON.stringify(passedSession)}\n`);
    await writeFile(resolve(project.outputDir, 'evaluations', 'evaluation-1', 'issues.jsonl'), `${JSON.stringify({ issueId: 'issue-1', severity: 'P1' })}\n`);
    await writeFile(resolve(project.outputDir, 'evaluations', 'evaluation-2', 'issues.jsonl'), '');
    await writeFile(resolve(project.outputDir, 'evaluations', 'evaluation-3', 'issues.jsonl'), '');

    const depths = await evaluationDepthOptions(cwd, project.projectId); const records = await listEvaluationRecords(cwd, project.projectId);
    expect(depths.find((item) => item.depth === 'core')).toEqual(expect.objectContaining({ recommended: true, estimatedCaseCount: 1 }));
    expect(depths.find((item) => item.depth === 'full')?.summary).toContain('所选功能');
    expect(records.find((item) => item.evaluationId === 'evaluation-1')).toEqual(expect.objectContaining({ displayName: expect.stringContaining('功能 A'), severeIssueCount: 1, verdict: 'needs_attention', coverage: null }));
    expect(records.find((item) => item.evaluationId === 'evaluation-2')).toEqual(expect.objectContaining({ capabilityNames: ['功能 A'], plannedCapabilityNames: ['功能 A', '功能 B'], verdict: 'needs_attention', coverage: expect.objectContaining({ notRunCount: 1 }) }));
    expect(records.find((item) => item.evaluationId === 'evaluation-3')).toEqual(expect.objectContaining({ capabilityNames: ['功能 A', '功能 B'], verdict: 'can_continue', coverage: expect.objectContaining({ complete: true }) }));
    await renameEvaluation(cwd, 'evaluation-1', { customName: '上线前核心检查' });
    expect((await listEvaluationRecords(cwd, project.projectId)).find((item) => item.evaluationId === 'evaluation-1')?.displayName).toBe('上线前核心检查');
  });
});
