import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { AgentProviderName, ApiResponse, BeforeAfterComparison, EvalBlueprint, EvaluationSession, FeatureJourneyGraph, Persona, ProjectBackground, ProjectCardSummary, UxIssue } from '../../types.js';
import { loadProjectRegistry } from '../projects/project-registry.js';
import { activateProject, discoverProject, registerProject, startProject } from '../projects/project-service.js';
import { activeProject, configForProject } from '../projects/project-registry.js';
import { getProjectStatus } from '../config/status.js';
import { projectBackgroundSchema } from '../schemas/background.js';
import { evalBlueprintSchema } from '../schemas/blueprint.js';
import { personaSchema, scenarioSchema } from '../schemas/scenario.js';
import { exploratoryScenarioSchema, featureJourneyGraphSchema } from '../schemas/ux-evaluation.js';
import { EvalPilotError } from '../utils/errors.js';
import { pathExists, readJsonLinesFile, readYamlFile, writeJsonAtomic, writeJsonLinesAtomic, writeYamlAtomic } from '../utils/file-system.js';
import { loadDashboardOverview, readOptionalText, validateDashboardHost } from './dashboard-data.js';
import { getDashboardRun, pauseDashboardRun, resumeDashboardRun, startDashboardRun, stopDashboardRun, subscribeDashboardRun, type ManagedRunEvent } from './run-manager.js';
import { evaluationDepthOptions, evaluationSnapshot, listEvaluationRecords, listEvaluations, renameEvaluation, retryEvaluation, startEvaluation, subscribeEvaluation } from './evaluation-manager.js';
import { agentSnapshot, applyFix, createFixTask, listAgentRuns, listFixTasks, startAgent, subscribeAgent } from '../agents/fix-service.js';
import { detectAgentConnections, discoverWorkspaceCandidates } from '../agents/agent-discovery.js';
import { workspaceCandidateRequestSchema } from '../schemas/workspace.js';
import { buildGuidedFlow } from './guidance-service.js';
import { presentIssue } from './issue-presenter.js';
import { inspectRuntime } from '../runtime/runtime-readiness.js';
import { dashboardAssetsRoot, isLegacyDataRoot } from '../runtime/paths.js';
import { evalCaseResultPath, loadEvalCaseResult } from '../judge/eval-result-store.js';
import { storageIdSchema } from '../eval-set/schemas.js';
import { evalSetSummary, findAdaptiveCase, generateAdaptiveFoundation, latestCoverage, latestProductModel, listAdaptiveCases, listAdaptiveRuns, projectBadcase, projectBadcases, projectFinding, projectFindings, regressionCases } from './adaptive-dashboard-data.js';
import { confirmProductFailure, dismissFinding, markEvaluatorFailure } from '../findings/finding-triage.js';
import { chromium } from 'playwright';
import { OpenAiProvider } from '../ai/openai-provider.js';
import { runAdaptiveCase } from '../evaluation/adaptive-evaluation-service.js';
import { loadEvalSetManifest } from '../eval-set/eval-set-store.js';
import { evidencePacketSchema } from '../test-agent/schemas.js';

interface ApiResult { status: number; body: ApiResponse<unknown> }
const execFileAsync = promisify(execFile);

function ok(data: unknown): ApiResult { return { status: 200, body: { success: true, data } }; }
function fail(status: number, code: string, message: string): ApiResult {
  return { status, body: { success: false, error: { code, message } } };
}

function recordBody(body: unknown): Record<string, unknown> | null {
  return body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
}

function validationFailure(code: string, issues: { path: PropertyKey[]; message: string }[]): ApiResult {
  return { status: 422, body: { success: false, error: { code, message: `数据校验失败：${issues.map((issue) => `${issue.path.join('.') || 'root'} ${issue.message}`).join('；')}` } } };
}

async function readJourneys(outputDir: string): Promise<FeatureJourneyGraph[]> {
  const directory = resolve(outputDir, 'journeys');
  if (!(await pathExists(directory))) return [];
  const names = (await readdir(directory)).filter((name) => name.endsWith('.yaml'));
  return Promise.all(names.map((name) => readYamlFile<FeatureJourneyGraph>(resolve(directory, name))));
}

async function readComparisons(outputDir: string): Promise<BeforeAfterComparison[]> {
  const directory = resolve(outputDir, 'comparisons');
  if (!(await pathExists(directory))) return [];
  const names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort().reverse();
  return Promise.all(names.map(async (name) => JSON.parse(await readOptionalText(resolve(directory, name)) ?? 'null') as BeforeAfterComparison));
}

async function readLatestRunArtifact<T>(outputDir: string, filename: string): Promise<T | null> {
  const directory = resolve(outputDir, 'runs');
  if (!(await pathExists(directory))) return null;
  const runIds = (await readdir(directory)).sort().reverse();
  for (const runId of runIds) {
    const path = resolve(directory, runId, filename);
    if (await pathExists(path)) return JSON.parse(await readOptionalText(path) ?? 'null') as T;
  }
  return null;
}

async function readRunHistory(outputDir: string): Promise<Array<{ runId: string; evaluation: unknown; metrics: unknown; comparison: unknown }>> {
  const directory = resolve(outputDir, 'runs');
  if (!(await pathExists(directory))) return [];
  const runIds = (await readdir(directory)).sort().reverse();
  const history = [];
  for (const runId of runIds) {
    const runDirectory = resolve(directory, runId);
    const [evaluation, metrics, comparison] = await Promise.all([
      readOptionalText(resolve(runDirectory, 'ux-evaluation.json')),
      readOptionalText(resolve(runDirectory, 'ux-metrics.json')),
      readOptionalText(resolve(runDirectory, 'journey-comparison.json')),
    ]);
    if (!evaluation && !metrics && !comparison) continue;
    history.push({ runId, evaluation: evaluation ? JSON.parse(evaluation) : null, metrics: metrics ? JSON.parse(metrics) : null, comparison: comparison ? JSON.parse(comparison) : null });
  }
  return history;
}

async function projectSummary(projectId: string, outputDir: string): Promise<ProjectCardSummary> {
  const sessionsPath = resolve(outputDir, 'evaluations', 'sessions.jsonl'); const issuesPath = resolve(outputDir, 'reports', 'ux-issues.jsonl');
  const sessions = await pathExists(sessionsPath) ? await readJsonLinesFile<EvaluationSession>(sessionsPath) : [];
  const issues = await pathExists(issuesPath) ? await readJsonLinesFile<UxIssue>(issuesPath) : [];
  const latest = sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  return { projectId, lastEvaluationAt: latest?.startedAt ?? null, lastEvaluationStatus: latest?.status ?? null, severeIssueCount: issues.filter((item) => item.severity === 'P0' || item.severity === 'P1').length };
}

export async function dispatchDashboardApi(cwd: string, method: string, pathname: string, search = '', body: unknown = null): Promise<ApiResult> {
  try {
    if (method === 'GET' && pathname === '/api/health') {
      const runtime = await inspectRuntime(cwd);
      return ok({
        status: 'ok',
        packageVersion: runtime.packageVersion,
        contractVersion: runtime.contractVersion,
        capabilities: ['guidance', 'structured_evidence', 'not_applicable_runs', 'workspace_discovery', 'task_package_handoff', 'adaptive_eval_set', 'hybrid_judge_assets', 'finding_triage'],
        runtime,
        aiTestAgent: { configured: Boolean(process.env.EVALPILOT_OPENAI_API_KEY?.trim()), provider: 'openai', screenshotDefault: false },
      });
    }
    const safeLegacyPost = pathname === '/api/workspace-candidates' || pathname === '/api/system/pick-directory' || pathname === '/api/connect/check' || /^\/api\/agents\/(codex|claude_code|antigravity)\/check$/.test(pathname);
    if (isLegacyDataRoot(cwd) && method !== 'GET' && !safeLegacyPost) return fail(409, 'LEGACY_DATA_READ_ONLY', '旧 .evalpilot 当前只能查看；请先运行 evalpilot migrate --confirmed。');
    if (method === 'GET' && pathname === '/api/guidance') { const query = new URLSearchParams(search); return ok(await buildGuidedFlow(cwd, query.get('projectId') ?? undefined)); }
    if (method === 'GET' && pathname === '/api/agents') return ok(await detectAgentConnections(false));
    const agentCheck = pathname.match(/^\/api\/agents\/(codex|claude_code|antigravity)\/check$/);
    if (method === 'POST' && agentCheck) {
      if (recordBody(body)?.confirmed !== true) return fail(409, 'CONFIRMATION_REQUIRED', '检查 Agent 登录状态前需要确认。');
      const provider = agentCheck[1] as AgentProviderName; const agents = await detectAgentConnections(true); return ok(agents.find((item) => item.provider === provider));
    }
    if (method === 'POST' && pathname === '/api/workspace-candidates') {
      const parsed = workspaceCandidateRequestSchema.safeParse(body);
      if (!parsed.success) return validationFailure('WORKSPACE_DISCOVERY_INVALID', parsed.error.issues);
      return ok(await discoverWorkspaceCandidates(parsed.data.providers));
    }
    if (method === 'POST' && pathname === '/api/system/pick-directory') {
      if (process.platform !== 'darwin') return fail(501, 'FOLDER_PICKER_UNAVAILABLE', '当前系统不支持文件夹选择器，请使用手动路径。');
      try {
        const result = await execFileAsync('osascript', ['-e', 'POSIX path of (choose folder with prompt "选择要评测的项目文件夹")'], { encoding: 'utf8' });
        return ok({ path: result.stdout.trim().replace(/\/$/, '') });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return fail(message.includes('User canceled') || message.includes('-128') ? 409 : 500, message.includes('User canceled') || message.includes('-128') ? 'FOLDER_PICKER_CANCELLED' : 'FOLDER_PICKER_FAILED', message.includes('User canceled') || message.includes('-128') ? '没有选择文件夹；也可以直接粘贴路径。' : '文件夹选择器未能打开，请使用手动路径。');
      }
    }
    if (method === 'GET' && pathname === '/api/projects') { const registry = await loadProjectRegistry(cwd); return ok({ ...registry, summaries: await Promise.all(registry.projects.map((project) => projectSummary(project.projectId, project.outputDir))) }); }
    const adaptiveProjectRoute = pathname.match(/^\/api\/projects\/([^/]+)\/(product-model|eval-set|eval-cases|adaptive-runs|coverage|findings|badcases|regression)(\/generate)?$/);
    if (adaptiveProjectRoute) {
      const projectId = decodeURIComponent(adaptiveProjectRoute[1] ?? '');
      const resource = adaptiveProjectRoute[2];
      const config = await configForProject(cwd, projectId);
      if (method === 'POST' && resource === 'eval-set' && adaptiveProjectRoute[3] === '/generate') {
        if (recordBody(body)?.confirmed !== true) return fail(409, 'CONFIRMATION_REQUIRED', '生成评测集前需要明确确认。');
        return ok(await generateAdaptiveFoundation({ projectId, outputDir: config.outputDir }));
      }
      if (method !== 'GET' || adaptiveProjectRoute[3]) return fail(405, 'METHOD_NOT_ALLOWED', '该评测资产接口不支持这个操作。');
      if (resource === 'product-model') return ok(await latestProductModel(config.outputDir));
      if (resource === 'eval-set') return ok(await evalSetSummary(config.outputDir));
      if (resource === 'eval-cases') return ok(await listAdaptiveCases(config.outputDir));
      if (resource === 'adaptive-runs') return ok(await listAdaptiveRuns(config.outputDir));
      if (resource === 'coverage') return ok(await latestCoverage(config.outputDir));
      if (resource === 'findings') return ok(await projectFindings(config.outputDir));
      if (resource === 'badcases') return ok(await projectBadcases(config.outputDir));
      if (resource === 'regression') return ok(await regressionCases(config.outputDir));
    }
    if (method === 'POST' && pathname === '/api/projects/discover') {
      const input = recordBody(body); return ok(await discoverProject(String(input?.projectRoot ?? ''), typeof input?.targetUrl === 'string' ? input.targetUrl : null));
    }
    if (method === 'POST' && pathname === '/api/projects') return { status: 201, body: { success: true, data: await registerProject(cwd, body) } };
    const projectAction = pathname.match(/^\/api\/projects\/([^/]+)\/(activate|start|readiness)$/);
    if (projectAction) {
      const projectId = decodeURIComponent(projectAction[1] ?? ''); const operation = projectAction[2]; const input = recordBody(body);
      if (operation === 'readiness' && method === 'GET') { const project = (await loadProjectRegistry(cwd)).projects.find((item) => item.projectId === projectId); if (!project) return fail(404, 'PROJECT_NOT_FOUND', `没有找到项目：${projectId}`); return ok(await discoverProject(project.projectRoot, project.targetUrl, projectId)); }
      if (method !== 'POST' || input?.confirmed !== true) return fail(409, 'CONFIRMATION_REQUIRED', '该操作需要明确确认。');
      if (operation === 'activate') return ok(await activateProject(cwd, projectId));
      if (operation === 'start') return ok(await startProject(cwd, projectId, typeof input.command === 'string' ? input.command : undefined));
    }
    if (pathname === '/api/evaluations' && method === 'POST') return { status: 202, body: { success: true, data: await startEvaluation(cwd, body) } };
    if (pathname === '/api/evaluations' && method === 'GET') { const query = new URLSearchParams(search); const projectId = query.get('projectId') ?? (await activeProject(cwd)).projectId; return ok(await listEvaluations(cwd, projectId)); }
    if (pathname === '/api/evaluation-depths' && method === 'GET') { const query = new URLSearchParams(search); const projectId = query.get('projectId') ?? (await activeProject(cwd)).projectId; return ok(await evaluationDepthOptions(cwd, projectId)); }
    if (pathname === '/api/evaluation-records' && method === 'GET') { const query = new URLSearchParams(search); const projectId = query.get('projectId') ?? (await activeProject(cwd)).projectId; return ok(await listEvaluationRecords(cwd, projectId)); }
    if (method === 'PATCH' && /^\/api\/evaluations\/[^/]+$/.test(pathname)) { const id = decodeURIComponent(pathname.slice('/api/evaluations/'.length)); return ok(await renameEvaluation(cwd, id, body)); }
    if (method === 'POST' && /^\/api\/evaluations\/[^/]+\/retry$/.test(pathname)) { if (recordBody(body)?.confirmed !== true) return fail(409, 'CONFIRMATION_REQUIRED', '恢复评测前需要明确确认。'); const id = decodeURIComponent(pathname.slice('/api/evaluations/'.length, -'/retry'.length)); return ok(await retryEvaluation(cwd, id)); }
    if (method === 'GET' && /^\/api\/evaluations\/[^/]+$/.test(pathname)) { const id = decodeURIComponent(pathname.slice('/api/evaluations/'.length)); const snapshot = evaluationSnapshot(id); return snapshot ? ok(snapshot) : fail(404, 'EVALUATION_NOT_FOUND', `没有找到评测：${id}`); }
    if (pathname === '/api/fix-tasks' && method === 'POST') return { status: 201, body: { success: true, data: await createFixTask(cwd, body) } };
    if (pathname === '/api/fix-tasks' && method === 'GET') { const query = new URLSearchParams(search); const projectId = query.get('projectId') ?? (await activeProject(cwd)).projectId; return ok(await listFixTasks(cwd, projectId)); }
    if (method === 'GET' && /^\/api\/fix-tasks\/[^/]+\/agent-runs$/.test(pathname)) { const id = decodeURIComponent(pathname.slice('/api/fix-tasks/'.length, -'/agent-runs'.length)); return ok(await listAgentRuns(cwd, id)); }
    const fixAction = pathname.match(/^\/api\/fix-tasks\/([^/]+)\/(run|apply)$/);
    if (fixAction && method === 'POST') { const id = decodeURIComponent(fixAction[1] ?? ''); const input = recordBody(body); if (input?.confirmed !== true) return fail(409, 'CONFIRMATION_REQUIRED', '该操作需要明确确认。'); return ok(fixAction[2] === 'run' ? await startAgent(cwd, id, body) : await applyFix(cwd, id, body)); }
    if (method === 'GET' && /^\/api\/agent-runs\/[^/]+$/.test(pathname)) { const id = decodeURIComponent(pathname.slice('/api/agent-runs/'.length)); const snapshot = agentSnapshot(id); return snapshot ? ok(snapshot) : fail(404, 'AGENT_RUN_NOT_FOUND', `没有找到 Agent 运行：${id}`); }
    const query = new URLSearchParams(search); const requestedProjectId = query.get('projectId') ?? undefined; const config = await configForProject(cwd, requestedProjectId);
    if (method === 'POST' && /^\/api\/eval-cases\/[^/]+\/run$/.test(pathname)) {
      const input = recordBody(body); if (input?.confirmed !== true || input.allowRemoteModel !== true) return fail(409, 'CONFIRMATION_REQUIRED', '运行 AI Test Agent 前必须确认远程模型和最小化页面文本传输。');
      const apiKey = process.env.EVALPILOT_OPENAI_API_KEY?.trim(); if (!apiKey) return fail(409, 'AI_PROVIDER_NOT_CONFIGURED', '尚未配置实验 AI Provider。请在启动 Dashboard 前设置 EVALPILOT_OPENAI_API_KEY。');
      const caseId = decodeURIComponent(pathname.slice('/api/eval-cases/'.length, -'/run'.length)); const evalCase = await findAdaptiveCase(config.outputDir, caseId); if (!evalCase) return fail(404, 'EVAL_CASE_NOT_FOUND', `没有找到评测案例：${caseId}`);
      const [model, manifest, allCases] = await Promise.all([latestProductModel(config.outputDir), loadEvalSetManifest(config.outputDir), listAdaptiveCases(config.outputDir)]); if (!model) return fail(409, 'PRODUCT_MODEL_REQUIRED', '请先生成评测集，再运行 AI Test Agent。');
      const capability = model.capabilities.find((item) => item.capabilityId === evalCase.capabilityId); const entry = capability?.entryPoints[0] ?? config.targetUrl; let startingUrl: string; try { startingUrl = new URL(entry, config.targetUrl).toString(); } catch { return fail(422, 'STARTING_URL_INVALID', '该案例没有可用的公开起始页面。'); }
      const provider = new OpenAiProvider({ apiKey, model: process.env.EVALPILOT_OPENAI_MODEL?.trim() || 'gpt-5-mini' }); const browser = await chromium.launch({ headless: true });
      let targetAppGitSha: string | null = null; try { targetAppGitSha = (await execFileAsync('git', ['-C', config.projectRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 4_000 })).stdout.trim() || null; } catch { targetAppGitSha = null; }
      try { const page = await browser.newPage(); return ok(await runAdaptiveCase({ page, provider, outputDir: config.outputDir, evalCase, productModel: model, existingCases: allCases, startingUrl, evalSetVersion: manifest.version, targetAppGitSha, allowRemoteModel: true, allowScreenshotToProvider: input.allowScreenshot === true })); }
      finally { await browser.close(); }
    }
    if (method === 'GET' && /^\/api\/eval-cases\/[^/]+$/.test(pathname)) {
      const id = decodeURIComponent(pathname.slice('/api/eval-cases/'.length));
      const evalCase = await findAdaptiveCase(config.outputDir, id);
      return evalCase ? ok(evalCase) : fail(404, 'EVAL_CASE_NOT_FOUND', `没有找到评测案例：${id}`);
    }
    if (method === 'GET' && /^\/api\/badcases\/[^/]+$/.test(pathname)) {
      const id = decodeURIComponent(pathname.slice('/api/badcases/'.length));
      const badcase = await projectBadcase(config.outputDir, storageIdSchema.parse(id));
      return badcase ? ok(badcase) : fail(404, 'BADCASE_NOT_FOUND', `没有找到 Badcase：${id}`);
    }
    if (method === 'GET' && /^\/api\/findings\/[^/]+$/.test(pathname)) {
      const id = storageIdSchema.parse(decodeURIComponent(pathname.slice('/api/findings/'.length)));
      const finding = await projectFinding(config.outputDir, id);
      return finding ? ok(finding) : fail(404, 'FINDING_NOT_FOUND', `没有找到问题发现：${id}`);
    }
    const findingAction = pathname.match(/^\/api\/findings\/([^/]+)\/(confirm-product-failure|mark-evaluator-failure|dismiss)$/);
    if (method === 'POST' && findingAction) {
      if (recordBody(body)?.confirmed !== true) return fail(409, 'CONFIRMATION_REQUIRED', '更改问题判断前需要明确确认。');
      const findingId = storageIdSchema.parse(decodeURIComponent(findingAction[1] ?? ''));
      if (!await projectFinding(config.outputDir, findingId)) return fail(404, 'FINDING_NOT_FOUND', `没有找到问题发现：${findingId}`);
      if (findingAction[2] === 'confirm-product-failure') return ok(await confirmProductFailure(config.outputDir, findingId));
      if (findingAction[2] === 'mark-evaluator-failure') return ok(await markEvaluatorFailure(config.outputDir, findingId));
      return ok(await dismissFinding(config.outputDir, findingId));
    }
    const adaptiveRunRoute = pathname.match(/^\/api\/runs\/([^/]+)\/(evidence|result)$/);
    if (method === 'GET' && adaptiveRunRoute) {
      const runId = storageIdSchema.parse(decodeURIComponent(adaptiveRunRoute[1] ?? ''));
      if (adaptiveRunRoute[2] === 'result') {
        const path = evalCaseResultPath(config.outputDir, runId);
        return await pathExists(path) ? ok(await loadEvalCaseResult(config.outputDir, runId)) : fail(404, 'RUN_RESULT_NOT_FOUND', `没有找到运行结果：${runId}`);
      }
      const path = resolve(config.outputDir, 'runs', runId, 'evidence-packet.json');
      const evidence = await readOptionalText(path);
      return evidence ? ok(evidencePacketSchema.parse(JSON.parse(evidence))) : fail(404, 'RUN_EVIDENCE_NOT_FOUND', `没有找到运行证据：${runId}`);
    }
    if (method === 'GET' && pathname === '/api/reports/history') return ok(await readRunHistory(config.outputDir));
    if (method === 'GET' && pathname === '/api/issues') { const evaluationId = query.get('evaluationId'); const issuesPath = evaluationId ? resolve(config.outputDir, 'evaluations', evaluationId, 'issues.jsonl') : resolve(config.outputDir, 'reports', 'ux-issues.jsonl'); const issues = await pathExists(issuesPath) ? await readJsonLinesFile<UxIssue>(issuesPath) : []; const dismissedPath = resolve(config.outputDir, 'reports', 'dismissed-issues.json'); const dismissed = await pathExists(dismissedPath) ? JSON.parse(await readOptionalText(dismissedPath) ?? '[]') as string[] : []; return ok(issues.map((item) => ({ ...presentIssue(item), dismissed: dismissed.includes(item.issueId) }))); }
    if (method === 'POST' && /^\/api\/issues\/[^/]+\/dismiss$/.test(pathname)) { if (recordBody(body)?.confirmed !== true) return fail(409, 'CONFIRMATION_REQUIRED', '暂不处理问题前需要确认。'); const id = decodeURIComponent(pathname.slice('/api/issues/'.length, -'/dismiss'.length)); const path = resolve(config.outputDir, 'reports', 'dismissed-issues.json'); const current = await pathExists(path) ? JSON.parse(await readOptionalText(path) ?? '[]') as string[] : []; await writeJsonAtomic(path, [...new Set([...current, id])]); return ok({ issueId: id, dismissed: true }); }
    if (method === 'GET' && pathname === '/api/overview') return ok(await loadDashboardOverview(config));
    if (method === 'GET' && pathname === '/api/status') return ok(await getProjectStatus(config));
    if (pathname === '/api/background' && method === 'GET') return ok(await readYamlFile<ProjectBackground>(resolve(config.outputDir, 'project-background.yaml')));
    if (pathname === '/api/background' && method === 'PATCH') {
      const current = await readYamlFile<ProjectBackground>(resolve(config.outputDir, 'project-background.yaml'));
      const parsed = projectBackgroundSchema.safeParse({ ...current, ...recordBody(body) });
      if (!parsed.success) return validationFailure('BACKGROUND_INVALID', parsed.error.issues);
      await writeYamlAtomic(resolve(config.outputDir, 'project-background.yaml'), parsed.data);
      return ok(parsed.data);
    }
    if (pathname === '/api/blueprint' && method === 'GET') return ok(await readYamlFile<EvalBlueprint>(resolve(config.outputDir, 'eval-blueprint.yaml')));
    if (pathname === '/api/blueprint' && method === 'PATCH') {
      const current = await readYamlFile<EvalBlueprint>(resolve(config.outputDir, 'eval-blueprint.yaml'));
      const parsed = evalBlueprintSchema.safeParse({ ...current, ...recordBody(body) });
      if (!parsed.success) return validationFailure('BLUEPRINT_INVALID', parsed.error.issues);
      await writeYamlAtomic(resolve(config.outputDir, 'eval-blueprint.yaml'), parsed.data);
      return ok(parsed.data);
    }
    if (method === 'GET' && pathname === '/api/personas') return ok(await readJsonLinesFile<Persona>(resolve(config.outputDir, 'personas.jsonl')));
    if (/^\/api\/personas\/[^/]+$/.test(pathname)) {
      const id = decodeURIComponent(pathname.slice('/api/personas/'.length));
      const path = resolve(config.outputDir, 'personas.jsonl');
      const personas = await readJsonLinesFile<Persona>(path);
      const index = personas.findIndex((item) => item.personaId === id);
      if (index < 0) return fail(404, 'PERSONA_NOT_FOUND', `没有找到模拟用户：${id}`);
      if (method === 'GET') return ok(personas[index]);
      if (method === 'PATCH') {
        const parsed = personaSchema.safeParse({ ...personas[index], ...recordBody(body), personaId: id });
        if (!parsed.success) return validationFailure('PERSONA_INVALID', parsed.error.issues);
        personas[index] = parsed.data;
        await writeJsonLinesAtomic(path, personas);
        return ok(parsed.data);
      }
    }
    if (method === 'GET' && pathname === '/api/journeys') return ok(await readJourneys(config.outputDir));
    if (method === 'GET' && pathname.startsWith('/api/journeys/')) {
      const id = decodeURIComponent(pathname.slice('/api/journeys/'.length));
      const journey = (await readJourneys(config.outputDir)).find((item) => item.featureId === id);
      return journey ? ok(journey) : fail(404, 'JOURNEY_NOT_FOUND', `没有找到功能旅程：${id}`);
    }
    if (method === 'PATCH' && pathname.startsWith('/api/journeys/')) {
      const id = decodeURIComponent(pathname.slice('/api/journeys/'.length));
      const path = resolve(config.outputDir, 'journeys', `${id}.yaml`);
      if (!(await pathExists(path))) return fail(404, 'JOURNEY_NOT_FOUND', `没有找到功能旅程：${id}`);
      const current = await readYamlFile<FeatureJourneyGraph>(path);
      const parsed = featureJourneyGraphSchema.safeParse({ ...current, ...recordBody(body), featureId: id });
      if (!parsed.success) return validationFailure('JOURNEY_INVALID', parsed.error.issues);
      await writeYamlAtomic(path, parsed.data);
      return ok(parsed.data);
    }
    if (method === 'GET' && pathname === '/api/cases') {
      const query = new URLSearchParams(search);
      const page = Math.max(1, Number(query.get('page') ?? 1));
      const pageSize = Math.min(100, Math.max(1, Number(query.get('pageSize') ?? 20)));
      const fixed = await readJsonLinesFile<unknown>(resolve(config.outputDir, 'scenarios.jsonl'));
      const exploratory = await readJsonLinesFile<unknown>(resolve(config.outputDir, 'exploratory-scenarios.jsonl'));
      const all = [...fixed.map((item) => ({ ...(item as object), type: 'deterministic_flow' })), ...exploratory];
      const start = (page - 1) * pageSize;
      return ok({ items: all.slice(start, start + pageSize), page, pageSize, total: all.length });
    }
    if (method === 'POST' && pathname === '/api/cases') {
      const input = recordBody(body);
      if (!input) return fail(400, 'CASE_INVALID', '案例请求体不能为空。');
      const exploratory = input.type === 'exploratory_user_journey';
      const parsed = exploratory ? exploratoryScenarioSchema.safeParse(input) : scenarioSchema.safeParse(input);
      if (!parsed.success) return validationFailure('CASE_INVALID', parsed.error.issues);
      const path = resolve(config.outputDir, exploratory ? 'exploratory-scenarios.jsonl' : 'scenarios.jsonl');
      const cases = await readJsonLinesFile<Record<string, unknown>>(path);
      if (cases.some((item) => item.caseId === parsed.data.caseId)) return fail(409, 'CASE_CONFLICT', `案例已存在：${parsed.data.caseId}`);
      cases.push(parsed.data);
      await writeJsonLinesAtomic(path, cases);
      return { status: 201, body: { success: true, data: parsed.data } };
    }
    if (/^\/api\/cases\/[^/]+$/.test(pathname) && (method === 'PATCH' || method === 'DELETE')) {
      const id = decodeURIComponent(pathname.slice('/api/cases/'.length));
      if (method === 'DELETE' && recordBody(body)?.confirmed !== true) return fail(409, 'CONFIRMATION_REQUIRED', '删除案例前需要明确确认。');
      for (const filename of ['scenarios.jsonl', 'exploratory-scenarios.jsonl']) {
        const path = resolve(config.outputDir, filename);
        const cases = await readJsonLinesFile<Record<string, unknown>>(path);
        const index = cases.findIndex((item) => item.caseId === id);
        if (index < 0) continue;
        if (method === 'DELETE') {
          cases.splice(index, 1); await writeJsonLinesAtomic(path, cases); return ok({ deletedId: id });
        }
        const candidate = { ...cases[index], ...recordBody(body), caseId: id };
        const parsed = filename.startsWith('exploratory') ? exploratoryScenarioSchema.safeParse(candidate) : scenarioSchema.safeParse(candidate);
        if (!parsed.success) return validationFailure('CASE_INVALID', parsed.error.issues);
        cases[index] = parsed.data; await writeJsonLinesAtomic(path, cases); return ok(parsed.data);
      }
      return fail(404, 'CASE_NOT_FOUND', `没有找到案例：${id}`);
    }
    if (method === 'GET' && pathname === '/api/reports/latest') {
      const evaluationId = query.get('evaluationId'); const selectedSession = evaluationId ? (await listEvaluations(cwd, requestedProjectId ?? (await activeProject(cwd)).projectId)).find((item) => item.evaluationId === evaluationId) : null; const selectedRunId = selectedSession?.runIds.at(-1); const selectedRunDirectory = selectedRunId ? selectedRunId.startsWith('/') ? selectedRunId : resolve(config.outputDir, 'runs', selectedRunId) : null;
      const [markdown, issues, evaluation, metrics, comparison, comparisons] = await Promise.all([
        evaluationId ? Promise.resolve(null) : readOptionalText(resolve(config.outputDir, 'reports', 'LATEST_UX_REPORT.md')),
        pathExists(evaluationId ? resolve(config.outputDir, 'evaluations', evaluationId, 'issues.jsonl') : resolve(config.outputDir, 'reports', 'ux-issues.jsonl')).then((exists) => exists ? readJsonLinesFile<UxIssue>(evaluationId ? resolve(config.outputDir, 'evaluations', evaluationId, 'issues.jsonl') : resolve(config.outputDir, 'reports', 'ux-issues.jsonl')) : []),
        selectedRunDirectory ? readOptionalText(resolve(selectedRunDirectory, 'ux-evaluation.json')).then((value) => value ? JSON.parse(value) : null) : readLatestRunArtifact(config.outputDir, 'ux-evaluation.json'),
        selectedRunDirectory ? readOptionalText(resolve(selectedRunDirectory, 'ux-metrics.json')).then((value) => value ? JSON.parse(value) : null) : readLatestRunArtifact(config.outputDir, 'ux-metrics.json'),
        selectedRunDirectory ? readOptionalText(resolve(selectedRunDirectory, 'journey-comparison.json')).then((value) => value ? JSON.parse(value) : null) : readLatestRunArtifact(config.outputDir, 'journey-comparison.json'),
        readComparisons(config.outputDir),
      ]);
      if (!markdown && !evaluation) return fail(404, 'REPORT_NOT_FOUND', '尚无 UX 报告，请先运行探索案例。');
      return ok({ markdown, issues: issues.map(presentIssue), evaluation, metrics, comparison, comparisons });
    }
    if (method === 'GET' && /^\/api\/runs\/[^/]+$/.test(pathname)) {
      const runId = decodeURIComponent(pathname.slice('/api/runs/'.length));
      const run = getDashboardRun(runId);
      return run ? ok(run) : fail(404, 'RUN_NOT_FOUND', `没有找到运行：${runId}`);
    }
    const controlMatch = pathname.match(/^\/api\/runs\/([^/]+)\/(pause|resume|stop)$/);
    if (method === 'POST' && controlMatch) {
      const runId = decodeURIComponent(controlMatch[1] ?? '');
      const operation = controlMatch[2];
      if (operation === 'stop' && recordBody(body)?.confirmed !== true) return fail(409, 'CONFIRMATION_REQUIRED', '停止运行前需要明确确认；已有轨迹会保存。');
      const run = operation === 'pause' ? pauseDashboardRun(runId) : operation === 'resume' ? resumeDashboardRun(runId) : stopDashboardRun(runId);
      if (!run) return fail(409, operation === 'pause' ? 'RUN_NOT_ACTIVE' : operation === 'resume' ? 'RUN_NOT_PAUSED' : 'RUN_NOT_ACTIVE', '当前运行状态不允许执行此操作。');
      return ok({ runId: run.runId, status: run.status });
    }
    if (method === 'GET' && pathname.startsWith('/api/comparisons/')) {
      const id = decodeURIComponent(pathname.slice('/api/comparisons/'.length));
      const path = resolve(config.outputDir, 'comparisons', `${id}.json`);
      if (!(await pathExists(path))) return fail(404, 'COMPARISON_NOT_FOUND', `没有找到对比记录：${id}`);
      return ok(JSON.parse(await readOptionalText(path) ?? 'null') as BeforeAfterComparison);
    }
    if (method === 'POST' && /^\/api\/issues\/[^/]+\/confirm$/.test(pathname)) {
      if (recordBody(body)?.confirmed !== true) return fail(409, 'CONFIRMATION_REQUIRED', '加入回归前需要明确人工确认。');
      const id = decodeURIComponent(pathname.slice('/api/issues/'.length, -'/confirm'.length));
      const path = resolve(config.outputDir, 'reports', 'ux-issues.jsonl');
      const issues = await readJsonLinesFile<UxIssue>(path);
      const index = issues.findIndex((item) => item.issueId === id);
      if (index < 0) return fail(404, 'ISSUE_NOT_FOUND', `没有找到问题：${id}`);
      issues[index] = { ...issues[index]!, addedToRegression: true };
      await writeJsonLinesAtomic(path, issues);
      return ok(issues[index]);
    }
    if (method === 'POST' && pathname === '/api/runs') {
      const request = body && typeof body === 'object' ? body as { caseId?: string; mode?: string } : {};
      if (request.mode && request.mode !== 'exploratory') return fail(400, 'RUN_MODE_INVALID', 'Dashboard 当前只支持 exploratory 运行。');
      const run = await startDashboardRun(config, request.caseId);
      return { status: 202, body: { success: true, data: { runId: run.runId, status: run.status } } };
    }
    return fail(404, 'API_NOT_FOUND', `本地 API 不存在：${method} ${pathname}`);
  } catch (error) {
    if (error instanceof EvalPilotError) return fail(error.code === 'NOT_INITIALIZED' ? 404 : 422, error.code, error.message);
    return fail(500, 'DASHBOARD_API_FAILED', error instanceof Error ? error.message : String(error));
  }
}

function sendJson(response: ServerResponse, result: ApiResult): void {
  response.writeHead(result.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(result.body));
}

function writeSse(response: ServerResponse, event: ManagedRunEvent): void {
  response.write(`id: ${event.id}\nevent: ${event.name}\ndata: ${JSON.stringify(event.data)}\n\n`);
}

const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.zip': 'application/zip' };

async function readRequestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return null;
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new EvalPilotError('请求体不是合法 JSON。', 'REQUEST_BODY_INVALID'); }
}

export async function startDashboardServer(cwd: string, port = 4173, assetsRoot = dashboardAssetsRoot(), autoFallback = false): Promise<{ port: number; close: () => Promise<void> }> {
  const staticRoot = resolve(assetsRoot);
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    try {
      if (!validateDashboardHost(request.headers.host)) {
        sendJson(response, fail(403, 'REMOTE_HOST_REJECTED', 'Dashboard 仅允许从本机访问。'));
        return;
      }
      const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
      const eventMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
      if (request.method === 'GET' && eventMatch) {
        const runId = decodeURIComponent(eventMatch[1] ?? '');
        const run = getDashboardRun(runId);
        if (!run) { sendJson(response, fail(404, 'RUN_NOT_FOUND', `没有找到运行：${runId}`)); return; }
        response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
        const lastEventId = Number(request.headers['last-event-id'] ?? 0);
        for (const event of run.events.filter((item) => item.id > lastEventId)) writeSse(response, event);
        if (run.status === 'completed' || run.status === 'failed' || run.status === 'stopped') { response.end(); return; }
        const unsubscribe = subscribeDashboardRun(runId, (event) => { writeSse(response, event); if (event.name === 'run.finished' || event.name === 'run.error') response.end(); });
        request.on('close', () => unsubscribe?.());
        return;
      }
      const evaluationEventMatch = url.pathname.match(/^\/api\/evaluations\/([^/]+)\/events$/);
      if (request.method === 'GET' && evaluationEventMatch) {
        const id = decodeURIComponent(evaluationEventMatch[1] ?? ''); const snapshot = evaluationSnapshot(id);
        if (!snapshot) { sendJson(response, fail(404, 'EVALUATION_NOT_FOUND', `没有找到评测：${id}`)); return; }
        response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
        for (const event of snapshot.events) response.write(`event: evaluation.progress\ndata: ${JSON.stringify(event)}\n\n`);
        if (snapshot.session.status === 'completed' || snapshot.session.status === 'failed') { response.end(); return; }
        const unsubscribe = subscribeEvaluation(id, (event) => { response.write(`event: evaluation.progress\ndata: ${JSON.stringify(event)}\n\n`); if (event.status === 'completed' || event.status === 'failed') response.end(); });
        request.on('close', () => unsubscribe?.()); return;
      }
      const agentEventMatch = url.pathname.match(/^\/api\/agent-runs\/([^/]+)\/events$/);
      if (request.method === 'GET' && agentEventMatch) {
        const id = decodeURIComponent(agentEventMatch[1] ?? ''); const snapshot = agentSnapshot(id);
        if (!snapshot) { sendJson(response, fail(404, 'AGENT_RUN_NOT_FOUND', `没有找到 Agent 运行：${id}`)); return; }
        response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
        for (const event of snapshot.events) response.write(`event: agent.progress\ndata: ${JSON.stringify(event)}\n\n`);
        if (snapshot.run.status === 'completed' || snapshot.run.status === 'failed') { response.end(); return; }
        const unsubscribe = subscribeAgent(id, (event) => { response.write(`event: agent.progress\ndata: ${JSON.stringify(event)}\n\n`); if (event.status === 'completed' || event.status === 'failed') response.end(); }); request.on('close', () => unsubscribe?.()); return;
      }
      if (request.method === 'GET' && url.pathname === '/api/evidence-file') {
        const config = await configForProject(cwd); const requested = url.searchParams.get('path') ?? ''; const path = resolve(requested.startsWith('/') ? requested : resolve(config.outputDir, requested));
        if (!path.startsWith(`${resolve(config.outputDir)}${sep}`) || !(await pathExists(path))) { sendJson(response, fail(404, 'EVIDENCE_NOT_FOUND', '没有找到该证据文件。')); return; }
        response.writeHead(200, { 'content-type': mime[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' }); createReadStream(path).pipe(response); return;
      }
      if (url.pathname.startsWith('/api/')) {
        const body = request.method === 'GET' || request.method === 'HEAD' ? null : await readRequestBody(request);
        sendJson(response, await dispatchDashboardApi(cwd, request.method ?? 'GET', url.pathname, url.search, body));
        return;
      }
      const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      let path = resolve(staticRoot, requested);
      if (!path.startsWith(`${staticRoot}${sep}`) && path !== resolve(staticRoot, 'index.html')) {
        response.writeHead(403); response.end('Forbidden'); return;
      }
      if (!(await pathExists(path)) || (await stat(path)).isDirectory()) path = resolve(staticRoot, 'index.html');
      response.writeHead(200, { 'content-type': mime[extname(path)] ?? 'application/octet-stream' });
      createReadStream(path).pipe(response);
    } catch (error) {
      sendJson(response, fail(500, 'DASHBOARD_SERVER_FAILED', error instanceof Error ? error.message : String(error)));
    }
  });
  const listen = (candidate: number) => new Promise<void>((resolveListen, reject) => {
    const onError = (error: Error) => { server.off('listening', onListen); reject(error); };
    const onListen = () => { server.off('error', onError); resolveListen(); };
    server.once('error', onError); server.once('listening', onListen); server.listen(candidate, '127.0.0.1');
  });
  let selectedPort = port;
  try {
    await listen(selectedPort);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE' && autoFallback) {
      let started = false;
      for (let candidate = port + 1; candidate <= port + 20; candidate += 1) {
        try { await listen(candidate); selectedPort = candidate; started = true; break; } catch (next) { if ((next as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw next; }
      }
      if (!started) throw new EvalPilotError(`本地端口 ${port}–${port + 20} 均被占用。`, 'DASHBOARD_START_FAILED');
    } else {
    throw new EvalPilotError(
      code === 'EADDRINUSE'
        ? `本地端口 ${port} 已被占用，请使用 dashboard --port <其他端口>。`
        : `Dashboard 无法启动：${error instanceof Error ? error.message : String(error)}`,
      'DASHBOARD_START_FAILED',
    );
    }
  }
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  return { port: actualPort, close: () => new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())) };
}
