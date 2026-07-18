import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, symlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { AgentEvent, AgentRun, AgentAdapterName, FixTask, FixVerification, UxIssue } from '../../types.js';
import { configForProject } from '../projects/project-registry.js';
import { agentRunRequestSchema, applyFixRequestSchema, fixTaskRequestSchema } from '../schemas/workspace.js';
import { EvalPilotError } from '../utils/errors.js';
import { ensureDirectory, pathExists, readJsonLinesFile, writeJsonAtomic, writeJsonLinesAtomic, writeTextAtomic } from '../utils/file-system.js';
import { runExploratoryScenario } from '../ux-evaluation/exploratory-runner.js';
import { buildConfirmedComparisons } from '../ux-evaluation/comparison-service.js';
import { detectAgentConnections, PUBLIC_ALPHA_DIRECT_FIX_ENABLED } from './agent-discovery.js';

const exec = promisify(execFile);
interface ManagedAgent { run: AgentRun; events: AgentEvent[]; listeners: Set<(event: AgentEvent) => void> }
const agents = new Map<string, ManagedAgent>();

function safeId(value: string): string { return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 48); }
function emit(item: ManagedAgent, message: string): void { const event: AgentEvent = { agentRunId: item.run.agentRunId, status: item.run.status, phase: item.run.phase, message, timestamp: new Date().toISOString() }; item.events.push(event); for (const listener of item.listeners) listener(event); }
async function git(root: string, args: string[]): Promise<string> { return (await exec('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 4_000_000 })).stdout.trim(); }
async function taskFile(outputDir: string): Promise<string> { await ensureDirectory(resolve(outputDir, 'fix-tasks')); return resolve(outputDir, 'fix-tasks', 'tasks.jsonl'); }
async function saveTask(outputDir: string, task: FixTask): Promise<void> { const path = await taskFile(outputDir); const tasks = await pathExists(path) ? await readJsonLinesFile<FixTask>(path) : []; const index = tasks.findIndex((item) => item.fixTaskId === task.fixTaskId); if (index < 0) tasks.push(task); else tasks[index] = task; await writeJsonLinesAtomic(path, tasks); }
async function issueFor(outputDir: string, issueId: string): Promise<UxIssue> { const path = resolve(outputDir, 'reports', 'ux-issues.jsonl'); const issues = await readJsonLinesFile<UxIssue>(path); const issue = issues.find((item) => item.issueId === issueId); if (!issue) throw new EvalPilotError(`没有找到问题：${issueId}`, 'ISSUE_NOT_FOUND'); return issue; }

async function verificationCommands(projectRoot: string): Promise<string[]> {
  try { const pkg = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }; return ['check', 'lint', 'test', 'build'].filter((name) => pkg.scripts?.[name]).slice(0, 3).map((name) => `npm run ${name}`); } catch { return []; }
}

function taskMarkdown(task: FixTask, issue: UxIssue, projectRoot: string): string {
  return `# EvalPilot 修复任务\n\n## 目标\n修复 ${issue.type}，让用户完成：${issue.userGoal}\n\n## 项目与基线\n- 项目：${projectRoot}\n- 基线：${task.baselineCommit ?? '无 Git'}\n- 隔离要求：每次 Agent 尝试必须从该基线创建独立分支和 worktree\n\n## 问题位置\n- 页面：${issue.location?.page ?? '尚未可靠定位'}\n- 步骤：${issue.location?.stepLabel ?? issue.failureOrAbandonmentPoint ?? '未明确'}\n- 目标元素：${issue.location?.target ?? '尚未可靠定位'}\n- 建议代码位置：${issue.location?.sourceFile ?? '尚未可靠定位'}\n\n## 真实证据\n- 实际路径：${issue.actualPath.join(' → ')}\n- 理想路径：${issue.idealPath.join(' → ')}\n- 卡点：${issue.failureOrAbandonmentPoint ?? '未明确'}\n${(issue.evidenceItems ?? []).map((item) => `- ${item.title}：${item.observation}（${item.sourcePath}）`).join('\n') || `- ${issue.evidence.join('；') || '无'}`}\n\n## 可能原因\n${issue.causeHypothesis ?? '证据不足，不得假定根因。'}\n\n## 建议修改\n${(issue.resolutionSteps ?? [issue.recommendation]).map((item) => `- ${item}`).join('\n')}\n\n## 约束\n- 只修改解决该问题所必需的文件。\n- 不读取或输出密钥。\n- 不删除安全确认步骤。\n- 不直接修改用户当前工作区。\n\n## 验收\n${task.verificationCommands.map((item) => `- ${item}`).join('\n') || '- 至少运行项目现有检查'}\n${(issue.verificationSteps ?? []).map((item) => `- ${item}`).join('\n')}\n- 复跑案例 ${task.retestCaseId ?? '待确认'}，完整闭环和安全步骤不得退化。\n`;
}

export async function createFixTask(cwd: string, input: unknown): Promise<FixTask> {
  const parsed = fixTaskRequestSchema.safeParse(input); if (!parsed.success) throw new EvalPilotError('创建修复任务前需要明确确认。', 'FIX_TASK_INVALID');
  const config = await configForProject(cwd, parsed.data.projectId); const issue = await issueFor(config.outputDir, parsed.data.issueId);
  let baselineCommit: string | null = null; try { baselineCommit = await git(config.projectRoot, ['rev-parse', 'HEAD']); } catch { /* non-git is blocked below */ }
  const stamp = Date.now(); const fixTaskId = `fix-${safeId(issue.issueId)}-${stamp}`; const taskDirectory = resolve(config.outputDir, 'fix-tasks', fixTaskId);
  const task: FixTask = { fixTaskId, projectId: parsed.data.projectId, issueId: issue.issueId, status: 'authorized', taskDirectory, baselineCommit, allowedScope: ['src/**', 'tests/**', 'docs/**'], verificationCommands: await verificationCommands(config.projectRoot), retestCaseId: issue.caseId, createdAt: new Date().toISOString(), authorizedAt: new Date().toISOString(), error: null };
  await ensureDirectory(taskDirectory); await writeJsonAtomic(resolve(taskDirectory, 'task.json'), { ...task, projectRoot: config.projectRoot, issue }); await writeTextAtomic(resolve(taskDirectory, 'task.md'), taskMarkdown(task, issue, config.projectRoot)); await saveTask(config.outputDir, task);
  const issuePath = resolve(config.outputDir, 'reports', 'ux-issues.jsonl'); const issues = await readJsonLinesFile<UxIssue>(issuePath); const index = issues.findIndex((item) => item.issueId === issue.issueId); issues[index] = { ...issue, addedToRegression: true }; await writeJsonLinesAtomic(issuePath, issues);
  return task;
}

export async function listFixTasks(cwd: string, projectId: string): Promise<FixTask[]> { const config = await configForProject(cwd, projectId); const path = await taskFile(config.outputDir); return await pathExists(path) ? readJsonLinesFile<FixTask>(path) : []; }
async function findTask(cwd: string, id: string): Promise<{ task: FixTask; outputDir: string; projectRoot: string }> { const registry = (await import('../projects/project-registry.js')).loadProjectRegistry; for (const project of (await registry(cwd)).projects) { const tasks = await listFixTasks(cwd, project.projectId); const task = tasks.find((item) => item.fixTaskId === id); if (task) return { task, outputDir: project.outputDir, projectRoot: project.projectRoot }; } throw new EvalPilotError(`没有找到修复任务：${id}`, 'FIX_TASK_NOT_FOUND'); }

export async function listAgentRuns(cwd: string, fixTaskId: string): Promise<AgentRun[]> {
  const found = await findTask(cwd, fixTaskId);
  const names = await readdir(found.task.taskDirectory).catch(() => []);
  const runs = await Promise.all(names.filter((name) => /^agent-.+\.json$/.test(name)).map(async (name) => JSON.parse(await readFile(resolve(found.task.taskDirectory, name), 'utf8')) as AgentRun));
  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

async function runChecks(task: FixTask, worktreePath: string): Promise<FixVerification['tests']> {
  const tests: FixVerification['tests'] = [];
  for (const command of task.verificationCommands) { const script = command.replace(/^npm run /, ''); try { await exec('npm', ['run', script], { cwd: worktreePath, timeout: 180_000, maxBuffer: 4_000_000 }); tests.push({ command, status: 'passed', summary: '通过' }); } catch (error) { tests.push({ command, status: 'failed', summary: error instanceof Error ? error.message.slice(0, 500) : String(error) }); } }
  return tests;
}

async function freePort(): Promise<number> { return new Promise((resolvePort, reject) => { const server = createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const address = server.address(); const port = typeof address === 'object' && address ? address.port : 0; server.close((error) => error ? reject(error) : resolvePort(port)); }); }); }

async function retest(cwd: string, task: FixTask, run: AgentRun, projectRoot: string): Promise<{ comparisonId: string | null; verdict: FixVerification['verdict']; blockers: string[] }> {
  const config = await configForProject(cwd, task.projectId); const issue = await issueFor(config.outputDir, task.issueId); const pkg = JSON.parse(await readFile(resolve(run.worktreePath!, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
  const script = pkg.scripts?.['dev:web'] ? 'dev:web' : pkg.scripts?.dev?.includes('vite') ? 'dev' : null;
  if (!script) return { comparisonId: null, verdict: 'needs_review', blockers: ['未识别到可隔离启动的 Vite 脚本，已保留任务包和测试结果。'] };
  const originalModules = resolve(projectRoot, 'node_modules'); const worktreeModules = resolve(run.worktreePath!, 'node_modules'); if (await pathExists(originalModules) && !(await pathExists(worktreeModules))) await symlink(originalModules, worktreeModules, 'dir');
  const port = await freePort(); const child = spawn('npm', ['run', script, '--', '--host', '127.0.0.1', '--port', String(port)], { cwd: run.worktreePath!, stdio: 'ignore' });
  try {
    const branchUrl = `http://127.0.0.1:${port}`; let ready = false; for (let index = 0; index < 40; index += 1) { await new Promise((wait) => setTimeout(wait, 250)); try { const response = await fetch(branchUrl); if (response.status < 500) { ready = true; break; } } catch { /* wait */ } if (child.exitCode !== null) break; }
    if (!ready) return { comparisonId: null, verdict: 'needs_review', blockers: ['修复分支测试网址未能启动。'] };
    const result = await runExploratoryScenario({ ...config, projectRoot: run.worktreePath!, targetUrl: branchUrl }, task.retestCaseId ?? undefined); const comparisons = await buildConfirmedComparisons(config, [{ ...issue, addedToRegression: true }], result); const comparison = comparisons[0];
    return comparison ? { comparisonId: comparison.comparisonId, verdict: comparison.verdict === 'needs_human_review' ? 'needs_review' : comparison.verdict, blockers: comparison.verdict === 'improved' ? [] : [`修复复测结果为 ${comparison.verdict}。`] } : { comparisonId: null, verdict: 'needs_review', blockers: ['缺少可关联的修复前证据，无法自动生成前后对比。'] };
  } finally { child.kill('SIGTERM'); }
}

async function saveAgentRun(taskDirectory: string, run: AgentRun): Promise<void> {
  await writeJsonAtomic(resolve(taskDirectory, `${run.agentRunId}.json`), run);
}

async function loadAgentRun(taskDirectory: string, agentRunId: string): Promise<AgentRun | null> {
  const live = agents.get(agentRunId)?.run;
  if (live) return live;
  const path = resolve(taskDirectory, `${agentRunId}.json`);
  return await pathExists(path) ? JSON.parse(await readFile(path, 'utf8')) as AgentRun : null;
}

export async function startAgent(cwd: string, fixTaskId: string, input: unknown): Promise<AgentRun> {
  const parsed = agentRunRequestSchema.safeParse(input); if (!parsed.success) throw new EvalPilotError('启动 Agent 前需要明确确认。', 'AGENT_RUN_INVALID');
  const found = await findTask(cwd, fixTaskId);
  const active = [...agents.values()].find((item) => item.run.fixTaskId === fixTaskId && (item.run.status === 'queued' || item.run.status === 'running'));
  if (active) throw new EvalPilotError('这个修复任务已有一个 Agent 正在运行；请等待完成或停止后再试。', 'AGENT_RUN_CONFLICT');
  const direct = parsed.data.adapter === 'codex' && PUBLIC_ALPHA_DIRECT_FIX_ENABLED;
  if (direct && !found.task.baselineCommit) throw new EvalPilotError('Codex 隔离修复需要 Git 项目；当前仍可使用通用任务包。', 'GIT_REQUIRED');
  if (direct) {
    const codex = (await detectAgentConnections(true)).find((item) => item.provider === 'codex');
    if (!codex?.capabilities.directFix) throw new EvalPilotError(codex?.blockers[0] ?? 'Codex 当前不能直接修复，请使用任务包。', 'CODEX_NOT_READY');
  }
  const agentRunId = `agent-${Date.now()}-${randomUUID().slice(0, 8)}`; const logFile = resolve(found.task.taskDirectory, `${agentRunId}.log`);
  const handoff = !direct;
  const run: AgentRun = { agentRunId, fixTaskId, adapter: parsed.data.adapter, executionMode: handoff ? 'handoff' : 'direct', phase: 'queued', status: 'queued', branch: null, worktreePath: null, logFile, changedFiles: [], requiresUserAction: null, verification: null, exitCode: null, startedAt: new Date().toISOString(), completedAt: null, error: null };
  const managed: ManagedAgent = { run, events: [], listeners: new Set() }; agents.set(agentRunId, managed);
  if (handoff) {
    const provider = parsed.data.adapter === 'task_package' ? '任意 Agent' : parsed.data.adapter === 'claude_code' ? 'Claude Code' : parsed.data.adapter === 'antigravity' ? 'Antigravity' : 'Codex';
    run.status = 'completed'; run.phase = 'waiting_user'; run.completedAt = new Date().toISOString(); run.requiresUserAction = `在 ${provider} 中打开隔离项目后，使用 ${resolve(found.task.taskDirectory, 'task.md')} 继续。`;
    await writeTextAtomic(logFile, `Public Alpha 未自动执行 ${provider}；任务包已生成，未修改目标项目。\n`); emit(managed, `${provider} 采用任务包交接；未调用 Codex，也未修改目标项目。`); await saveAgentRun(found.task.taskDirectory, run); return run;
  }
  run.branch = `evalpilot/codex-${safeId(found.task.issueId)}-${safeId(agentRunId)}`;
  run.worktreePath = resolve(found.outputDir, 'fix-worktrees', agentRunId);
  await saveAgentRun(found.task.taskDirectory, run);
  void (async () => {
    let log = ''; found.task.status = 'running'; run.status = 'running'; run.phase = 'preparing'; emit(managed, '正在创建本次运行专属的隔离修复分支。');
    try {
      await ensureDirectory(resolve(found.outputDir, 'fix-worktrees')); await git(found.projectRoot, ['worktree', 'add', '-b', run.branch!, run.worktreePath!, found.task.baselineCommit!]); await saveTask(found.outputDir, found.task);
      const appBin = '/Applications/ChatGPT.app/Contents/Resources/codex'; const codexBin = process.env.CODEX_BIN ?? (await pathExists(appBin) ? appBin : 'codex'); const prompt = await readFile(resolve(found.task.taskDirectory, 'task.md'), 'utf8');
      run.phase = 'analyzing'; emit(managed, 'Codex 正在分析并修改隔离工作区。'); const child = spawn(codexBin, ['exec', '--json', '-C', run.worktreePath!, '-s', 'workspace-write', '-'], { stdio: ['pipe', 'pipe', 'pipe'] }); child.stdin.end(prompt); child.stdout.on('data', (chunk) => { log += String(chunk); run.phase = 'editing'; emit(managed, 'Codex 正在工作。'); }); child.stderr.on('data', (chunk) => { log += String(chunk); });
      const timeoutMs = Math.max(1_000, Number(process.env.CODEX_TIMEOUT_MS ?? 900_000)); let timedOut = false;
      const exitCode = await new Promise<number>((resolveExit, reject) => { const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs); child.once('error', (error) => { clearTimeout(timer); reject(error); }); child.once('close', (code) => { clearTimeout(timer); resolveExit(code ?? 1); }); }); run.exitCode = exitCode; await writeTextAtomic(logFile, log);
      if (timedOut) throw new EvalPilotError(`Codex 超过 ${Math.round(timeoutMs / 1_000)} 秒未完成，已安全停止并保留日志。`, 'CODEX_TIMEOUT');
      if (exitCode !== 0) throw new EvalPilotError('Codex 执行失败，请查看运行日志。', 'CODEX_RUN_FAILED');
      run.changedFiles = (await git(run.worktreePath!, ['status', '--short'])).split('\n').filter(Boolean).map((line) => line.slice(3)); if (!run.changedFiles.length) throw new EvalPilotError('Codex 未产生代码改动。', 'CODEX_NO_CHANGES');
      const allowedPrefixes = found.task.allowedScope.map((pattern) => pattern.replace(/\/\*\*$/, '').replace(/\/$/, '')); const disallowed = run.changedFiles.filter((file) => !allowedPrefixes.some((prefix) => file === prefix || file.startsWith(`${prefix}/`))); if (disallowed.length) throw new EvalPilotError(`Codex 修改了授权范围外的文件：${disallowed.join('、')}。改动保留在隔离 worktree，未提交也未应用。`, 'CODEX_SCOPE_VIOLATION');
      await git(run.worktreePath!, ['add', '-A']); await git(run.worktreePath!, ['commit', '-m', `fix: resolve ${found.task.issueId}`]); run.phase = 'testing'; emit(managed, '代码已修改，正在运行项目检查。'); const tests = await runChecks(found.task, run.worktreePath!); const missingTests = tests.length === 0; const failed = missingTests || tests.some((item) => item.status !== 'passed');
      run.phase = 'retesting'; const comparison = failed ? { comparisonId: null, verdict: 'needs_review' as const, blockers: [missingTests ? '项目没有可执行的 check、lint、test 或 build 命令，不能自动判定修复安全。' : '项目检查失败，未执行自动复测。'] } : await retest(cwd, found.task, run, found.projectRoot);
      const verification: FixVerification = { fixTaskId, agentRunId, tests, comparisonId: comparison.comparisonId, verdict: comparison.verdict, safetyConstraintsPreserved: comparison.verdict !== 'regressed', safeToApply: !failed && comparison.verdict === 'improved', blockers: comparison.blockers, verifiedAt: new Date().toISOString() };
      run.verification = verification; found.task.status = verification.safeToApply ? 'ready_to_apply' : verification.verdict === 'regressed' ? 'blocked' : 'verified'; found.task.error = null; run.status = 'completed'; run.phase = 'completed'; run.completedAt = new Date().toISOString(); emit(managed, verification.safeToApply ? '修复已通过测试和复测，可以申请应用。' : '修复已完成，但仍需人工查看验证结果。');
    } catch (error) { run.status = 'failed'; run.error = error instanceof Error ? error.message : String(error); run.completedAt = new Date().toISOString(); found.task.status = 'failed'; found.task.error = run.error; emit(managed, `修复失败：${run.error}`); }
    await saveTask(found.outputDir, found.task); await saveAgentRun(found.task.taskDirectory, run);
  })();
  return run;
}

export function agentSnapshot(id: string): { run: AgentRun; events: AgentEvent[] } | null { const item = agents.get(id); return item ? { run: item.run, events: [...item.events] } : null; }
export function subscribeAgent(id: string, listener: (event: AgentEvent) => void): (() => void) | null { const item = agents.get(id); if (!item) return null; item.listeners.add(listener); return () => item.listeners.delete(listener); }

export async function applyFix(cwd: string, fixTaskId: string, input: unknown): Promise<FixTask> {
  const parsed = applyFixRequestSchema.safeParse(input); if (!parsed.success) throw new EvalPilotError('应用修复必须确认并指定已验证的 Agent 运行。', 'FIX_APPLY_INVALID');
  const found = await findTask(cwd, fixTaskId); const run = await loadAgentRun(found.task.taskDirectory, parsed.data.agentRunId);
  if (!run || run.fixTaskId !== fixTaskId) throw new EvalPilotError('没有找到这个修复任务对应的 Agent 运行。', 'AGENT_RUN_NOT_FOUND');
  if (!run.verification?.safeToApply || run.status !== 'completed' || !run.branch) throw new EvalPilotError('所选 Agent 运行尚未通过自动复测，不能应用。', 'FIX_NOT_SAFE_TO_APPLY');
  if ((await git(found.projectRoot, ['status', '--short'])).trim()) throw new EvalPilotError('当前项目有未提交改动，已保留修复分支但不会自动合并。', 'TARGET_WORKTREE_DIRTY');
  await git(found.projectRoot, ['merge', '--ff-only', run.branch]); found.task.status = 'applied'; await saveTask(found.outputDir, found.task); return found.task;
}
