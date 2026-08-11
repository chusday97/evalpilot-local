import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stringify } from 'yaml';
import { describe, expect, it } from 'vitest';
import type { EvalCase, EvalCaseResult, EvalPilotConfig } from '../types.js';
import { loadDashboardOverview, validateDashboardHost } from '../src/dashboard/dashboard-data.js';
import { dispatchDashboardApi } from '../src/dashboard/server.js';
import { saveCoverageMatrix } from '../src/eval-set/coverage-store.js';
import { saveFinding } from '../src/findings/finding-store.js';
import { saveEvalCase } from '../src/eval-set/eval-set-store.js';
import { saveEvalCaseResult } from '../src/judge/eval-result-store.js';

describe('dashboard local data boundary', () => {
  it('reports the local contract version before the UI calls feature APIs', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evalpilot-health-'));
    const result = await dispatchDashboardApi(cwd, 'GET', '/api/health', '', {});

    expect(result.status).toBe(200);
    expect(result.body).toEqual(expect.objectContaining({ success: true, data: expect.objectContaining({
      status: 'ok',
      contractVersion: '0.6.0',
      capabilities: expect.arrayContaining(['guidance', 'structured_evidence', 'not_applicable_runs', 'adaptive_eval_set', 'hybrid_judge_assets', 'finding_triage', 'product_task_understanding', 'oracle_builder']),
      aiProductUnderstanding: expect.objectContaining({ configured: false, provider: null, defaultEnabled: false, screenshotInput: false }),
    }) }));
  });

  it('returns one novice next step when no project is connected', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evalpilot-guidance-'));
    process.env.EVALPILOT_DATA_DIR = resolve(cwd, '.evalpilot-data');
    const result = await dispatchDashboardApi(cwd, 'GET', '/api/guidance', '', {});
    delete process.env.EVALPILOT_DATA_DIR;

    expect(result.status).toBe(200);
    if (!result.body.success) throw new Error(result.body.error.message);
    const guidance = result.body.data as { currentStep: string; projectId: string | null; steps: Array<{ status: string; actionLabel: string | null }> };
    expect(guidance).toEqual(expect.objectContaining({ currentStep: 'project', projectId: null }));
    expect(guidance.steps.filter((step) => step.status === 'current')).toHaveLength(1);
    expect(guidance.steps[0]?.actionLabel).toBe('连接第一个项目');
  });

  it('does not treat a cached ready project as currently reachable', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evalpilot-stale-readiness-'));
    const dataDir = resolve(cwd, 'data'); const outputDir = resolve(dataDir, 'projects', 'stale-ready'); const now = new Date().toISOString();
    await mkdir(outputDir, { recursive: true });
    await writeFile(resolve(cwd, 'package.json'), JSON.stringify({ name: 'stale-ready' }));
    await writeFile(resolve(dataDir, 'projects.json'), JSON.stringify({ version: 1, activeProjectId: 'stale-ready', projects: [{ projectId: 'stale-ready', name: 'Stale ready', projectRoot: cwd, targetUrl: 'http://127.0.0.1:9', outputDir, browser: 'chromium', startCommand: null, status: 'ready', importSource: 'manual', preferredAgent: null, createdAt: now, updatedAt: now, lastOpenedAt: now }] }));
    process.env.EVALPILOT_DATA_DIR = dataDir;
    try {
      const result = await dispatchDashboardApi(cwd, 'GET', '/api/guidance', '?projectId=stale-ready', {});
      expect(result.body).toEqual(expect.objectContaining({ success: true, data: expect.objectContaining({ currentStep: 'project', steps: expect.arrayContaining([expect.objectContaining({ id: 'project', status: 'current', actionLabel: '启动当前项目' })]) }) }));
    } finally { delete process.env.EVALPILOT_DATA_DIR; }
  });

  it('recomputes the next action from the requested evaluation instead of the latest session', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evalpilot-next-action-api-'));
    const dataDir = resolve(cwd, 'data'); const outputDir = resolve(dataDir, 'projects', 'project-next'); const now = new Date().toISOString();
    await mkdir(resolve(outputDir, 'evaluations'), { recursive: true });
    await writeFile(resolve(dataDir, 'projects.json'), JSON.stringify({ version: 1, activeProjectId: 'project-next', projects: [{ projectId: 'project-next', name: 'Next', projectRoot: cwd, targetUrl: 'http://127.0.0.1:3000', outputDir, browser: 'chromium', startCommand: null, status: 'ready', importSource: 'manual', preferredAgent: null, createdAt: now, updatedAt: now, lastOpenedAt: now }] }));
    const evalCase: EvalCase = { caseId: 'case-next', projectId: 'project-next', setType: 'baseline', status: 'stable', origin: { type: 'human', note: 'fixture' }, capabilityId: 'cap-next', taskId: null, title: '完成任务', hypothesis: '任务可完成', persona: { personaId: 'persona', name: '用户', behaviorPolicy: ['使用可见控件'] }, goal: '完成', knownInformation: {}, preconditions: [], oracle: { expectedOutcome: ['完成'], mustObserve: [], mustNotObserve: [], businessRules: [], semanticRubric: ['用户能确认任务完成'], deterministicAssertions: [], inconclusiveWhen: ['缺少完成状态证据'] }, coverageDimensions: [{ dimension: 'capability', value: 'cap-next' }], riskLevel: 'P1', generationReason: 'fixture', version: 1, stats: { passCount: 1, failCount: 0, inconclusiveCount: 0, latestResult: 'pass', latestRunId: 'run-next', uniqueCoverageContribution: 1, lastExecutedAt: now }, regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: now, updatedAt: now };
    const result: EvalCaseResult = { runId: 'run-next', caseId: 'case-next', verdict: 'pass', failureSource: null, severity: null, deterministic: { checks: [], hardFailure: false, severity: null, evidenceRefs: [] }, semantic: { verdict: 'pass', taskCompletion: 'complete', summary: '任务完成', whatWorked: ['任务完成'], whatFailed: [], whyItMatters: [], confirmedFacts: ['完成状态可见'], hypotheses: [], unknowns: [], evidenceRefs: [], confidence: 1 }, evidencePacketPath: 'runs/run-next/evidence-packet.json', createdAt: now };
    await saveEvalCase(outputDir, evalCase); await saveEvalCaseResult(outputDir, result);
    const session = (evaluationId: string, runIds: string[]) => ({ evaluationId, projectId: 'project-next', sequenceNumber: evaluationId === 'evaluation-older' ? 1 : 2, runtime: 'adaptive', depth: 'core', capabilityIds: ['cap-next'], capabilityNames: ['任务'], plannedCapabilityIds: ['cap-next'], plannedCapabilityNames: ['任务'], executedCapabilityIds: runIds.length ? ['cap-next'] : [], executedCapabilityNames: runIds.length ? ['任务'] : [], selectedCaseIds: ['case-next'], coverage: null, coverageMatrix: null, customName: null, competitorSnapshotIds: [], issueIds: [], findingIds: [], badcaseIds: [], remoteModelAuthorized: true, screenshotAuthorized: false, status: 'completed', currentStage: 'report', stages: [], runIds, startedAt: now, completedAt: now, error: null });
    await writeFile(resolve(outputDir, 'evaluations', 'sessions.jsonl'), `${JSON.stringify(session('evaluation-older', ['run-next']))}\n${JSON.stringify(session('evaluation-latest', []))}\n`);
    process.env.EVALPILOT_DATA_DIR = dataDir;
    try {
      const older = await dispatchDashboardApi(cwd, 'GET', '/api/evaluations/evaluation-older/next-action', '?projectId=project-next', {});
      const latest = await dispatchDashboardApi(cwd, 'GET', '/api/evaluations/evaluation-latest/next-action', '?projectId=project-next', {});
      expect(older.body).toEqual(expect.objectContaining({ success: true, data: expect.objectContaining({ type: 'no_action' }) }));
      expect(latest.body).toEqual(expect.objectContaining({ success: true, data: expect.objectContaining({ type: 'run_remaining_cases', targetCaseIds: ['case-next'] }) }));
    } finally { delete process.env.EVALPILOT_DATA_DIR; }
  });

  it('loads a non-technical overview from initialized local artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evalpilot-dashboard-'));
    await mkdir(resolve(root, 'journeys'), { recursive: true });
    await mkdir(resolve(root, 'reports'), { recursive: true });
    const config: EvalPilotConfig = {
      version: 1, projectRoot: root, targetUrl: 'http://localhost:3000', outputDir: root,
      browser: 'chromium', createdAt: new Date().toISOString(),
    };
    await writeFile(resolve(root, 'project-background.yaml'), stringify({ projectName: 'Fixture' }));
    await writeFile(resolve(root, 'eval-blueprint.yaml'), stringify({ projectName: 'Fixture', capabilities: [] }));
    await writeFile(resolve(root, 'personas.jsonl'), '{"personaId":"p1","name":"新用户"}\n');
    await writeFile(resolve(root, 'scenarios.jsonl'), '{"caseId":"c1","title":"固定案例"}\n');
    await writeFile(resolve(root, 'exploratory-scenarios.jsonl'), '{"caseId":"e1","title":"探索案例"}\n');
    await writeFile(resolve(root, 'reports', 'ux-issues.jsonl'), '');

    const overview = await loadDashboardOverview(config);

    expect(overview.projectName).toBe('Fixture');
    expect(overview.personaCount).toBe(1);
    expect(overview.caseCount).toBe(2);
    expect(overview.localOnly).toBe(true);
  });

  it('accepts loopback hosts and rejects remote hosts', () => {
    expect(validateDashboardHost('127.0.0.1:4173')).toBe(true);
    expect(validateDashboardHost('localhost:4173')).toBe(true);
    expect(validateDashboardHost('example.com:4173')).toBe(false);
  });

  it('requires explicit confirmation before deleting a case', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evalpilot-dashboard-api-'));
    const outputDir = resolve(cwd, '.evalpilot-data');
    await mkdir(resolve(outputDir, 'reports'), { recursive: true });
    await writeFile(resolve(outputDir, 'config.yaml'), stringify({
      version: 1, projectRoot: cwd, targetUrl: 'http://localhost:3000', outputDir,
      browser: 'chromium', createdAt: new Date().toISOString(),
    }));
    await writeFile(resolve(outputDir, 'scenarios.jsonl'), '{"caseId":"c1"}\n');
    await writeFile(resolve(outputDir, 'exploratory-scenarios.jsonl'), '');

    process.env.EVALPILOT_DATA_DIR = outputDir;
    const result = await dispatchDashboardApi(cwd, 'DELETE', '/api/cases/c1', '', { confirmed: false });
    delete process.env.EVALPILOT_DATA_DIR;

    expect(result.status).toBe(409);
    expect(result.body).toEqual(expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'CONFIRMATION_REQUIRED' }) }));
  });

  it('rejects applying a fix without the exact verified agent run', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evalpilot-fix-apply-'));
    const result = await dispatchDashboardApi(cwd, 'POST', '/api/fix-tasks/missing/apply', '', { confirmed: true });
    expect(result.status).toBe(422);
    expect(result.body).toEqual(expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'FIX_APPLY_INVALID' }) }));
  });

  it('returns honest empty adaptive assets before the first Eval Set is generated', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evalpilot-adaptive-api-'));
    const dataDir = resolve(cwd, 'data'); const outputDir = resolve(dataDir, 'projects', 'project-demo');
    await mkdir(outputDir, { recursive: true });
    const now = new Date().toISOString();
    await writeFile(resolve(dataDir, 'projects.json'), JSON.stringify({ version: 1, activeProjectId: 'project-demo', projects: [{ projectId: 'project-demo', name: 'Demo', projectRoot: cwd, targetUrl: 'http://127.0.0.1:3000', outputDir, browser: 'chromium', startCommand: null, status: 'ready', importSource: 'manual', preferredAgent: null, createdAt: now, updatedAt: now, lastOpenedAt: now }] }));
    process.env.EVALPILOT_DATA_DIR = dataDir;
    try {
      const summary = await dispatchDashboardApi(cwd, 'GET', '/api/projects/project-demo/eval-set', '', {});
      const runs = await dispatchDashboardApi(cwd, 'GET', '/api/projects/project-demo/adaptive-runs', '', {});
      const coverage = await dispatchDashboardApi(cwd, 'GET', '/api/projects/project-demo/coverage', '', {});
      const aiFoundation = await dispatchDashboardApi(cwd, 'POST', '/api/projects/project-demo/eval-set/generate', '', { confirmed: true, allowRemoteModel: true });
      const agentRun = await dispatchDashboardApi(cwd, 'POST', '/api/eval-cases/missing/run', '?projectId=project-demo', { confirmed: true, allowRemoteModel: true });
      expect(summary.body).toEqual(expect.objectContaining({ success: true, data: expect.objectContaining({ manifest: null, counts: { baseline: 0, regression: 0, challenge: 0, exploratory: 0 } }) }));
      expect(runs.body).toEqual({ success: true, data: [] });
      expect(coverage.body).toEqual({ success: true, data: null });
      expect(aiFoundation.body).toEqual(expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'AI_PROVIDER_NOT_CONFIGURED', message: expect.stringContaining('选择一个模型服务') }) }));
      expect(agentRun.body).toEqual(expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'AI_PROVIDER_NOT_CONFIGURED' }) }));
    } finally { delete process.env.EVALPILOT_DATA_DIR; }
  });

  it('returns asset, execution, and verified coverage as separate API truths', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evalpilot-coverage-api-'));
    const dataDir = resolve(cwd, 'data'); const outputDir = resolve(dataDir, 'projects', 'project-demo');
    await mkdir(outputDir, { recursive: true });
    const now = new Date().toISOString();
    await writeFile(resolve(dataDir, 'projects.json'), JSON.stringify({ version: 1, activeProjectId: 'project-demo', projects: [{ projectId: 'project-demo', name: 'Demo', projectRoot: cwd, targetUrl: 'http://127.0.0.1:3000', outputDir, browser: 'chromium', startCommand: null, status: 'ready', importSource: 'manual', preferredAgent: null, createdAt: now, updatedAt: now, lastOpenedAt: now }] }));
    await saveCoverageMatrix(outputDir, { projectId: 'project-demo', generatedAt: now, dimensions: [{ dimension: 'capability', targetValues: ['cap-demo'], coveredValues: [], missingValues: ['cap-demo'], coverageRatio: 0 }], gaps: [{ gapId: 'gap-cap-demo', kind: 'not_executed', capabilityId: 'cap-demo', dimension: 'capability', missingValue: 'cap-demo', priority: 'critical', reason: '案例已定义但尚未执行。', candidateCaseIds: [] }], totalTargetCells: 1, assetCoveredCells: 1, executedCells: 0, verifiedCells: 0, coveredCells: 0, assetCoverageRatio: 1, executionCoverageRatio: 0, verifiedCoverageRatio: 0, cells: [{ cellId: 'cell-cap-demo', capabilityId: 'cap-demo', dimension: 'capability', value: 'cap-demo', assetStatus: 'stable', executionStatus: 'not_run', caseIds: ['case-demo'], latestRunId: null, latestResultAt: null, verified: false }], coverageRatio: 0 });
    process.env.EVALPILOT_DATA_DIR = dataDir;
    try {
      const response = await dispatchDashboardApi(cwd, 'GET', '/api/projects/project-demo/coverage', '', {});
      expect(response.body).toEqual(expect.objectContaining({ success: true, data: expect.objectContaining({ assetCoverageRatio: 1, executionCoverageRatio: 0, verifiedCoverageRatio: 0, coverageRatio: 0 }) }));
    } finally { delete process.env.EVALPILOT_DATA_DIR; }
  });

  it('lists candidate findings and requires explicit confirmation for triage actions', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evalpilot-finding-api-'));
    const dataDir = resolve(cwd, 'data'); const outputDir = resolve(dataDir, 'projects', 'project-demo'); const now = new Date().toISOString();
    await mkdir(outputDir, { recursive: true });
    await writeFile(resolve(dataDir, 'projects.json'), JSON.stringify({ version: 1, activeProjectId: 'project-demo', projects: [{ projectId: 'project-demo', name: 'Demo', projectRoot: cwd, targetUrl: 'http://127.0.0.1:3000', outputDir, browser: 'chromium', startCommand: null, status: 'ready', importSource: 'manual', preferredAgent: null, createdAt: now, updatedAt: now, lastOpenedAt: now }] }));
    await saveFinding(outputDir, { findingId: 'finding-run-api', projectId: 'project-demo', caseId: 'case-api', runId: 'run-api', title: '可疑问题', summary: '点击后没有反馈', status: 'candidate', semanticConfidence: 0.6, deterministicSupport: false, independentEvidenceTypes: ['screenshot'], confirmedFacts: ['点击已执行'], hypotheses: [], unknowns: ['是否属于产品问题'], evidenceRefs: ['after.png'], createdAt: now, updatedAt: now });
    process.env.EVALPILOT_DATA_DIR = dataDir;
    try {
      const list = await dispatchDashboardApi(cwd, 'GET', '/api/projects/project-demo/findings', '', {});
      const mutation = await dispatchDashboardApi(cwd, 'POST', '/api/findings/finding-run-api/dismiss', '?projectId=project-demo', { confirmed: false });
      expect(list.body).toEqual(expect.objectContaining({ success: true, data: [expect.objectContaining({ status: 'candidate' })] }));
      expect(mutation.body).toEqual(expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'CONFIRMATION_REQUIRED' }) }));
    } finally { delete process.env.EVALPILOT_DATA_DIR; }
  });
});
