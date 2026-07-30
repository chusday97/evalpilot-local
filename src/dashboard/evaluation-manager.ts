import { resolve } from 'node:path';
import type { EvaluationDepthOption, EvaluationEvent, EvaluationRecordSummary, EvaluationSession, EvaluationStageName, EvalBlueprint, ExploratoryScenario, PageEvidence, RunStatus, Scenario, UxIssue } from '../../types.js';
import { generateBackground } from '../generation/background-builder.js';
import { generateBlueprint } from '../generation/blueprint-builder.js';
import { generateCases } from '../generation/scenario-builder.js';
import { buildReport } from '../report/report-builder.js';
import { runScenarios } from '../runner/scenario-runner.js';
import { scanProject } from '../scanner/scan-project.js';
import { evaluationRequestSchema } from '../schemas/workspace.js';
import { evaluationRenameSchema } from '../schemas/workspace.js';
import { EvalPilotError } from '../utils/errors.js';
import { ensureDirectory, pathExists, readJsonLinesFile, readYamlFile, writeJsonAtomic, writeJsonLinesAtomic } from '../utils/file-system.js';
import { runExploratoryScenario } from '../ux-evaluation/exploratory-runner.js';
import { configForProject } from '../projects/project-registry.js';
import { loadProjectRegistry } from '../projects/project-registry.js';
import { discoverProject } from '../projects/project-service.js';
import { readOptionalText } from './dashboard-data.js';
import { buildEvaluationCoverage, planCapabilities, recordCapabilityRun, selectExploratoryScenarios } from './evaluation-coverage.js';

interface ManagedEvaluation { session: EvaluationSession; events: EvaluationEvent[]; listeners: Set<(event: EvaluationEvent) => void> }
const evaluations = new Map<string, ManagedEvaluation>();
const stageNames: EvaluationStageName[] = ['readiness', 'scan', 'background', 'blueprint', 'cases', 'run', 'report'];

async function persist(outputDir: string, session: EvaluationSession): Promise<void> {
  const path = resolve(outputDir, 'evaluations', 'sessions.jsonl'); await ensureDirectory(resolve(outputDir, 'evaluations'));
  const existing = await pathExists(path) ? await readJsonLinesFile<EvaluationSession>(path) : [];
  const index = existing.findIndex((item) => item.evaluationId === session.evaluationId);
  if (index < 0) existing.push(session); else existing[index] = session;
  await writeJsonLinesAtomic(path, existing.sort((a, b) => b.startedAt.localeCompare(a.startedAt)));
}

function emit(managed: ManagedEvaluation, message: string): void {
  const event: EvaluationEvent = { evaluationId: managed.session.evaluationId, status: managed.session.status, stage: managed.session.currentStage, message, timestamp: new Date().toISOString() };
  managed.events.push(event); for (const listener of managed.listeners) listener(event);
}

async function executeEvaluation(cwd: string, managed: ManagedEvaluation): Promise<void> {
  const session = managed.session; const config = await configForProject(cwd, session.projectId); session.status = 'running'; session.error = null; session.completedAt = null;
  try {
    if (session.stages.find((item) => item.name === 'readiness')?.status !== 'completed') { await setStage(managed, config.outputDir, 'readiness', 'running', '正在检查项目与测试网址。'); const readiness = await discoverProject(config.projectRoot, config.targetUrl, session.projectId); if (!readiness.canEvaluate) throw new EvalPilotError(readiness.blockers.join('；'), 'PROJECT_NOT_READY'); await setStage(managed, config.outputDir, 'readiness', 'completed', '项目已就绪。'); }
    if (session.stages.find((item) => item.name === 'scan')?.status !== 'completed') { await setStage(managed, config.outputDir, 'scan', 'running', '正在扫描代码、文档和页面证据。'); await scanProject(config); await setStage(managed, config.outputDir, 'scan', 'completed', '事实证据扫描完成。'); }
    if (session.stages.find((item) => item.name === 'background')?.status !== 'completed') { await setStage(managed, config.outputDir, 'background', 'running', '正在生成产品背景。'); await generateBackground(config); await setStage(managed, config.outputDir, 'background', 'completed', '产品背景已生成。'); }
    let blueprint: EvalBlueprint;
    if (session.stages.find((item) => item.name === 'blueprint')?.status !== 'completed') { await setStage(managed, config.outputDir, 'blueprint', 'running', '正在生成评测蓝图。'); blueprint = await generateBlueprint(config); await setStage(managed, config.outputDir, 'blueprint', 'completed', '评测蓝图已生成。'); } else blueprint = await readYamlFile<EvalBlueprint>(resolve(config.outputDir, 'eval-blueprint.yaml'));
    let exploratory: ExploratoryScenario[];
    if (session.stages.find((item) => item.name === 'cases')?.status !== 'completed') { await setStage(managed, config.outputDir, 'cases', 'running', '正在生成模拟用户、案例和旅程。'); exploratory = (await generateCases(config)).exploratoryScenarios; await setStage(managed, config.outputDir, 'cases', 'completed', '评测案例已生成。'); } else exploratory = await readJsonLinesFile<ExploratoryScenario>(resolve(config.outputDir, 'exploratory-scenarios.jsonl'));
    const plannedCapabilities = planCapabilities(blueprint.capabilities, session.capabilityIds, session.depth);
    session.plannedCapabilityIds = plannedCapabilities.map((item) => item.id);
    session.plannedCapabilityNames = plannedCapabilities.map((item) => item.name);
    let visitedPaths: string[] = [];
    const rawPages = await readOptionalText(resolve(config.outputDir, 'evidence', 'pages.json'));
    if (rawPages) {
      try {
        const pages = JSON.parse(rawPages) as PageEvidence[];
        visitedPaths = pages.flatMap((item) => {
          try { return [new URL(item.url).pathname]; } catch { return []; }
        });
      } catch { /* 旧扫描证据格式不可读时保持零个已到达页面。 */ }
    }
    if (session.stages.find((item) => item.name === 'run')?.status !== 'completed' || !session.coverage) {
      session.coverage = buildEvaluationCoverage(blueprint.capabilities, plannedCapabilities, visitedPaths);
    }
    const selectedScenarios = selectExploratoryScenarios(exploratory, session.plannedCapabilityIds, session.depth);
    await persist(config.outputDir, session);
    if (!selectedScenarios.length) throw new EvalPilotError('所选功能没有可运行的探索案例。', 'EVALUATION_CASE_NOT_FOUND');
    if (session.stages.find((item) => item.name === 'run')?.status !== 'completed') {
      await setStage(managed, config.outputDir, 'run', 'running', 'Chromium 正在按不同功能执行真实路径。');
      session.runIds = []; session.executedCapabilityIds = []; session.executedCapabilityNames = [];
      const evaluationIssues: UxIssue[] = [];
      if (session.depth === 'full') {
        const fixedScenarios = (await readJsonLinesFile<Scenario>(resolve(config.outputDir, 'scenarios.jsonl')))
          .filter((item) => item.automationStatus === 'automated' && session.plannedCapabilityIds.includes(item.capability));
        const capabilityByCase = new Map(fixedScenarios.map((item) => [item.caseId, item.capability]));
        const fixed = await runScenarios(config, undefined, session.plannedCapabilityIds);
        session.runIds.push(fixed.runDirectory);
        for (const result of fixed.results) {
          const capabilityId = capabilityByCase.get(result.caseId);
          if (capabilityId && session.coverage) session.coverage = recordCapabilityRun(session.coverage, capabilityId, result.runId, result.status, Boolean(result.finalUrl));
        }
        await buildReport(config);
      }
      for (const scenario of selectedScenarios) {
        const result = await runExploratoryScenario(config, scenario.caseId); session.runIds.push(result.runId);
        const status: RunStatus = result.evaluation.functionalStatus === 'blocked'
          ? 'blocked'
          : result.evaluation.functionalStatus === 'passed' && result.metrics.fullLoopCompleted
            ? 'passed'
            : 'failed';
        if (session.coverage) session.coverage = recordCapabilityRun(session.coverage, scenario.capability, result.runId, status, result.evaluation.functionalStatus !== 'blocked');
        for (const issue of result.issues) if (!evaluationIssues.some((item) => item.issueId === issue.issueId)) evaluationIssues.push(issue);
      }
      const executed = session.coverage?.capabilities.filter((item) => session.plannedCapabilityIds.includes(item.capabilityId) && item.executionStatus !== 'not_run') ?? [];
      session.executedCapabilityIds = executed.map((item) => item.capabilityId);
      session.executedCapabilityNames = executed.map((item) => item.capabilityName);
      session.capabilityNames = session.executedCapabilityNames;
      const evaluationDirectory = resolve(config.outputDir, 'evaluations', session.evaluationId); await ensureDirectory(evaluationDirectory); await writeJsonLinesAtomic(resolve(evaluationDirectory, 'issues.jsonl'), evaluationIssues); session.issueIds = evaluationIssues.map((item) => item.issueId);
      const coverageMessage = session.coverage?.complete
        ? `已实际运行 ${session.coverage.executedCount} 个计划功能。`
        : `仍有 ${session.coverage?.notRunCount ?? session.plannedCapabilityIds.length} 个计划功能未运行。`;
      await setStage(managed, config.outputDir, 'run', 'completed', `真实路径执行完成。${coverageMessage}`);
    }
    if (session.stages.find((item) => item.name === 'report')?.status !== 'completed') { await setStage(managed, config.outputDir, 'report', 'running', '正在整理问题、覆盖证据和下一步。'); await writeJsonAtomic(resolve(config.outputDir, 'evaluations', session.evaluationId, 'report.json'), { evaluationId: session.evaluationId, generatedAt: new Date().toISOString(), blueprintCapabilities: plannedCapabilities, coverage: session.coverage }); await setStage(managed, config.outputDir, 'report', 'completed', '评测报告已生成。'); }
    session.status = 'completed'; session.completedAt = new Date().toISOString(); emit(managed, '评测完成，可以查看问题。'); await persist(config.outputDir, session);
  } catch (error) { session.status = 'failed'; session.error = error instanceof Error ? error.message : String(error); session.completedAt = new Date().toISOString(); const stage = session.stages.find((item) => item.name === session.currentStage)!; stage.status = 'failed'; stage.message = session.error; emit(managed, `评测停止：${session.error}`); await persist(config.outputDir, session); }
}

async function setStage(managed: ManagedEvaluation, outputDir: string, name: EvaluationStageName, status: 'running' | 'completed' | 'failed', message: string): Promise<void> {
  managed.session.currentStage = name; const stage = managed.session.stages.find((item) => item.name === name)!; stage.status = status; stage.message = message; emit(managed, message); await persist(outputDir, managed.session);
}

export async function startEvaluation(cwd: string, input: unknown): Promise<EvaluationSession> {
  const parsed = evaluationRequestSchema.safeParse(input); if (!parsed.success) throw new EvalPilotError('评测范围无效。', 'EVALUATION_INVALID');
  const config = await configForProject(cwd, parsed.data.projectId); const evaluationId = `evaluation-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const existing = await listEvaluations(cwd, parsed.data.projectId);
  const session: EvaluationSession = { evaluationId, projectId: parsed.data.projectId, sequenceNumber: existing.length + 1, depth: parsed.data.depth, capabilityIds: parsed.data.capabilityIds, capabilityNames: [], plannedCapabilityIds: [], plannedCapabilityNames: [], executedCapabilityIds: [], executedCapabilityNames: [], coverage: null, customName: null, competitorSnapshotIds: parsed.data.competitorSnapshotIds, issueIds: [], status: 'queued', currentStage: 'readiness', stages: stageNames.map((name) => ({ name, status: 'pending', message: null })), runIds: [], startedAt: new Date().toISOString(), completedAt: null, error: null };
  const managed: ManagedEvaluation = { session, events: [], listeners: new Set() }; evaluations.set(evaluationId, managed); await persist(config.outputDir, session);
  void executeEvaluation(cwd, managed);
  return session;
}

function normalizeSessions(raw: EvaluationSession[]): EvaluationSession[] {
  const ordered = [...raw].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return ordered.map((item, index) => ({
    ...item,
    sequenceNumber: item.sequenceNumber ?? index + 1,
    capabilityNames: item.capabilityNames ?? [],
    plannedCapabilityIds: item.plannedCapabilityIds ?? item.capabilityIds ?? [],
    plannedCapabilityNames: item.plannedCapabilityNames ?? item.capabilityNames ?? [],
    executedCapabilityIds: item.executedCapabilityIds ?? [],
    executedCapabilityNames: item.executedCapabilityNames ?? [],
    coverage: item.coverage ?? null,
    customName: item.customName ?? null,
    competitorSnapshotIds: item.competitorSnapshotIds ?? [],
    issueIds: item.issueIds ?? [],
  })).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function renameEvaluation(cwd: string, evaluationId: string, input: unknown): Promise<EvaluationSession> {
  const parsed = evaluationRenameSchema.safeParse(input); if (!parsed.success) throw new EvalPilotError('评测名称需为 1–80 个字符。', 'EVALUATION_NAME_INVALID');
  for (const project of (await loadProjectRegistry(cwd)).projects) {
    const sessions = await listEvaluations(cwd, project.projectId); const index = sessions.findIndex((item) => item.evaluationId === evaluationId); if (index < 0) continue;
    sessions[index] = { ...sessions[index]!, customName: parsed.data.customName }; const path = resolve(project.outputDir, 'evaluations', 'sessions.jsonl'); await writeJsonLinesAtomic(path, sessions); return sessions[index]!;
  }
  throw new EvalPilotError(`没有找到评测：${evaluationId}`, 'EVALUATION_NOT_FOUND');
}

function displayName(session: EvaluationSession): string {
  if (session.customName) return session.customName;
  const depth = session.depth === 'quick' ? '快速检查' : session.depth === 'full' ? '完整评测' : '核心评测';
  const names = session.coverage ? session.executedCapabilityNames : session.capabilityNames;
  const capability = names.length > 1 ? `${names[0]}等 ${names.length} 项` : names[0] ?? '未完成评测';
  const date = new Date(session.startedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  return `${capability} · ${depth} · ${date}`;
}

export async function listEvaluationRecords(cwd: string, projectId: string): Promise<EvaluationRecordSummary[]> {
  const config = await configForProject(cwd, projectId); const sessions = await listEvaluations(cwd, projectId); const records: EvaluationRecordSummary[] = [];
  for (const session of sessions) {
    const issuesPath = resolve(config.outputDir, 'evaluations', session.evaluationId, 'issues.jsonl'); const hasSnapshot = await pathExists(issuesPath); const issues = hasSnapshot ? await readJsonLinesFile<UxIssue>(issuesPath) : [];
    const severeIssueCount = issues.filter((item) => item.severity === 'P0' || item.severity === 'P1').length; const durationMs = session.completedAt ? Math.max(0, new Date(session.completedAt).getTime() - new Date(session.startedAt).getTime()) : null;
    let notApplicableCount = session.coverage?.notApplicableCount ?? 0;
    if (!session.coverage) {
      for (const runId of session.runIds) {
        const directory = runId.startsWith('/') ? runId : resolve(config.outputDir, 'runs', runId);
        const raw = await readOptionalText(resolve(directory, 'summary.json'));
        if (!raw) continue;
        try { const summary = JSON.parse(raw) as { notApplicable?: number; results?: Array<{ status?: string }> }; notApplicableCount += summary.notApplicable ?? summary.results?.filter((item) => item.status === 'not_applicable').length ?? 0; } catch { /* 旧运行没有可读取的不适用统计。 */ }
      }
    }
    const coveragePassed = Boolean(
      session.coverage?.complete
      && session.coverage.notRunCount === 0
      && session.coverage.failedCount === 0
      && session.coverage.blockedCount === 0,
    );
    const verdict = session.status === 'failed'
      ? 'needs_attention'
      : session.status !== 'completed'
        ? 'unknown'
        : severeIssueCount > 0 || Boolean(session.coverage && !coveragePassed)
          ? 'needs_attention'
          : coveragePassed
            ? 'can_continue'
            : 'unknown';
    const names = session.coverage ? session.executedCapabilityNames : session.capabilityNames;
    records.push({
      evaluationId: session.evaluationId,
      projectId,
      sequenceNumber: session.sequenceNumber,
      displayName: displayName(session),
      depth: session.depth,
      capabilityIds: session.coverage ? session.executedCapabilityIds : session.capabilityIds,
      capabilityNames: names,
      plannedCapabilityNames: session.plannedCapabilityNames,
      coverage: session.coverage,
      status: session.status,
      verdict,
      severeIssueCount,
      issueCount: issues.length,
      notApplicableCount,
      durationMs,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      legacyEvidenceIncomplete: !hasSnapshot || !session.coverage,
    });
  }
  return records;
}

export async function evaluationDepthOptions(cwd: string, projectId: string): Promise<EvaluationDepthOption[]> {
  const config = await configForProject(cwd, projectId); let exploratoryCount = 0; let fixedCount = 0;
  try { exploratoryCount = (await readJsonLinesFile<ExploratoryScenario>(resolve(config.outputDir, 'exploratory-scenarios.jsonl'))).length; } catch { /* first evaluation has not generated cases */ }
  try { fixedCount = (await readJsonLinesFile<Scenario>(resolve(config.outputDir, 'scenarios.jsonl'))).filter((item) => item.automationStatus === 'automated').length; } catch { /* first evaluation has not generated cases */ }
  const sessions = (await listEvaluations(cwd, projectId)).filter((item) => item.completedAt);
  const estimate = (depth: EvaluationSession['depth']): number | null => { const values = sessions.filter((item) => item.depth === depth && item.completedAt).map((item) => (new Date(item.completedAt!).getTime() - new Date(item.startedAt).getTime()) / 60_000).filter((item) => item > 0); return values.length ? Math.max(1, Math.round(values.reduce((sum, item) => sum + item, 0) / values.length)) : null; };
  return [
    { depth: 'quick', label: '快速检查', summary: '只走 1 条最关键路径', suitableFor: '适合刚改完一个地方', durationLabel: '耗时最短', estimatedCaseCount: exploratoryCount ? 1 : null, estimatedDurationMinutes: estimate('quick'), recommended: false, recommendedReason: '只想马上确认刚才的修改还能正常使用。', includes: ['最重要功能的一条用户路径', '页面是否能完成目标'], excludes: ['其他功能', '异常和回归案例'] },
    { depth: 'core', label: '核心评测', summary: '检查最重要的功能，最多 3 条路径', suitableFor: '适合提测或上线前', durationLabel: '耗时适中', estimatedCaseCount: exploratoryCount ? Math.min(3, exploratoryCount) : null, estimatedDurationMinutes: estimate('core'), recommended: true, recommendedReason: '覆盖最常用和最重要的任务，时间与完整度最平衡。', includes: ['必须能用和重要功能', '最多 3 条真实用户路径', '截图和操作轨迹'], excludes: ['低优先级功能的完整回归', '与项目无关的 API 异常'] },
    { depth: 'full', label: '完整评测', summary: '检查所选功能的正常、异常和回归路径', suitableFor: '适合重要版本验收', durationLabel: '耗时最长', estimatedCaseCount: exploratoryCount || fixedCount ? exploratoryCount + fixedCount : null, estimatedDurationMinutes: estimate('full'), recommended: false, recommendedReason: '准备重要发布，需要保留最完整的证据。', includes: ['所选功能的固定案例', '探索路径和已有回归', '适用的异常恢复检查'], excludes: ['未选择的功能', '项目客观不存在的业务 API'] },
  ];
}

export async function retryEvaluation(cwd: string, evaluationId: string): Promise<EvaluationSession> {
  let managed = evaluations.get(evaluationId);
  if (!managed) {
    for (const project of (await loadProjectRegistry(cwd)).projects) {
      const sessions = await listEvaluations(cwd, project.projectId); const session = sessions.find((item) => item.evaluationId === evaluationId);
      if (session) { managed = { session, events: [], listeners: new Set() }; evaluations.set(evaluationId, managed); break; }
    }
  }
  if (!managed) throw new EvalPilotError(`没有找到评测：${evaluationId}`, 'EVALUATION_NOT_FOUND');
  if (managed.session.status !== 'failed' && managed.session.status !== 'stopped') throw new EvalPilotError('只有失败或中断的评测可以恢复。', 'EVALUATION_NOT_RECOVERABLE');
  const failed = managed.session.stages.find((item) => item.status === 'failed'); if (failed) { failed.status = 'pending'; failed.message = null; }
  managed.session.status = 'queued'; void executeEvaluation(cwd, managed); return managed.session;
}

export function evaluationSnapshot(id: string): { session: EvaluationSession; events: EvaluationEvent[] } | null { const item = evaluations.get(id); return item ? { session: item.session, events: [...item.events] } : null; }
export function subscribeEvaluation(id: string, listener: (event: EvaluationEvent) => void): (() => void) | null { const item = evaluations.get(id); if (!item) return null; item.listeners.add(listener); return () => item.listeners.delete(listener); }
export async function listEvaluations(cwd: string, projectId: string): Promise<EvaluationSession[]> { const config = await configForProject(cwd, projectId); const path = resolve(config.outputDir, 'evaluations', 'sessions.jsonl'); return normalizeSessions(await pathExists(path) ? await readJsonLinesFile<EvaluationSession>(path) : []); }
