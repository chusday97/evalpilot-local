import type { DashboardRunStatus, EvalPilotConfig, InteractionAction, RunEvent } from '../../types.js';
import { runExploratoryScenario, type ExploratoryRunSummary } from '../ux-evaluation/exploratory-runner.js';
import { buildConfirmedComparisons } from '../ux-evaluation/comparison-service.js';
import { pathExists, readJsonLinesFile } from '../utils/file-system.js';
import { resolve } from 'node:path';
import type { UxIssue } from '../../types.js';

export interface ManagedRunEvent { id: number; name: 'run.status' | 'run.action' | 'run.error' | 'run.finished'; data: RunEvent }
export interface ManagedRunSnapshot { runId: string; status: DashboardRunStatus; events: ManagedRunEvent[]; result: ExploratoryRunSummary | null; error: string | null }

interface ManagedRun extends ManagedRunSnapshot {
  listeners: Set<(event: ManagedRunEvent) => void>;
  controller: AbortController;
  resumeWaiters: Set<() => void>;
}
const runs = new Map<string, ManagedRun>();

function emit(run: ManagedRun, name: ManagedRunEvent['name'], message: string, action: InteractionAction | null = null): void {
  const event: ManagedRunEvent = { id: run.events.length + 1, name, data: { runId: run.runId, status: run.status, timestamp: new Date().toISOString(), action, message } };
  run.events.push(event);
  for (const listener of run.listeners) listener(event);
}

export async function startDashboardRun(config: EvalPilotConfig, caseId?: string): Promise<ManagedRunSnapshot> {
  const issuePath = resolve(config.outputDir, 'reports', 'ux-issues.jsonl');
  const confirmedIssues = await pathExists(issuePath) ? (await readJsonLinesFile<UxIssue>(issuePath)).filter((issue) => issue.addedToRegression) : [];
  const runId = `run-dashboard-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const run: ManagedRun = { runId, status: 'queued', events: [], result: null, error: null, listeners: new Set(), controller: new AbortController(), resumeWaiters: new Set() };
  runs.set(runId, run);
  emit(run, 'run.status', '探索运行已进入队列。');
  run.status = 'running';
  emit(run, 'run.status', 'Chromium 已启动，模拟用户正在自主寻找路径。');
  void runExploratoryScenario(config, caseId, {
    runId,
    onAction: (action) => emit(run, 'run.action', action.target ? `执行 ${action.type}：${action.target}` : action.outcome, action),
    signal: run.controller.signal,
    beforeAction: () => run.status !== 'paused' ? Promise.resolve() : new Promise<void>((resolveResume) => run.resumeWaiters.add(resolveResume)),
  }).then(async (result) => {
    run.result = result;
    await buildConfirmedComparisons(config, confirmedIssues, result);
    if (run.status !== 'stopped') run.status = 'completed';
    emit(run, 'run.finished', run.status === 'stopped' ? '运行已停止，已有轨迹和部分报告已保存。' : result.metrics.fullLoopCompleted ? '运行完成：用户目标和后续闭环均完成。' : '运行完成：已保存未完成或摩擦证据。');
  }).catch((error) => {
    run.error = error instanceof Error ? error.message : String(error);
    run.status = 'failed';
    emit(run, 'run.error', run.error);
  });
  return snapshot(run);
}

function snapshot(run: ManagedRun): ManagedRunSnapshot {
  return { runId: run.runId, status: run.status, events: [...run.events], result: run.result, error: run.error };
}

export function getDashboardRun(runId: string): ManagedRunSnapshot | null {
  const run = runs.get(runId);
  return run ? snapshot(run) : null;
}

export function subscribeDashboardRun(runId: string, listener: (event: ManagedRunEvent) => void): (() => void) | null {
  const run = runs.get(runId);
  if (!run) return null;
  run.listeners.add(listener);
  return () => run.listeners.delete(listener);
}

export function pauseDashboardRun(runId: string): ManagedRunSnapshot | null {
  const run = runs.get(runId);
  if (!run || run.status !== 'running') return null;
  run.status = 'paused';
  emit(run, 'run.status', '运行已暂停；浏览器上下文和已有轨迹保持不变。');
  return snapshot(run);
}

export function resumeDashboardRun(runId: string): ManagedRunSnapshot | null {
  const run = runs.get(runId);
  if (!run || run.status !== 'paused') return null;
  run.status = 'running';
  for (const resume of run.resumeWaiters) resume();
  run.resumeWaiters.clear();
  emit(run, 'run.status', '运行已继续。');
  return snapshot(run);
}

export function stopDashboardRun(runId: string): ManagedRunSnapshot | null {
  const run = runs.get(runId);
  if (!run || (run.status !== 'running' && run.status !== 'paused')) return null;
  run.status = 'stopped';
  run.controller.abort();
  for (const resume of run.resumeWaiters) resume();
  run.resumeWaiters.clear();
  emit(run, 'run.status', '正在安全停止；已有轨迹会保存。');
  return snapshot(run);
}
