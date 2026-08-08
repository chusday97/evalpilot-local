import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { stringify } from 'yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDashboardServer } from '../src/dashboard/server.js';
import { buildPersonas } from '../src/generation/persona-builder.js';
import { buildExploratoryScenarios } from '../src/ux-evaluation/exploratory-scenario-builder.js';
import { buildFeatureJourneyGraph } from '../src/ux-evaluation/journey-graph-builder.js';
import type { BlueprintCapability, EvalBlueprint } from '../types.js';
import type { Badcase, CandidateFinding, EvalCase, EvalCaseResult } from '../types.js';
import { saveEvalCase } from '../src/eval-set/eval-set-store.js';
import { saveCoverageMatrix } from '../src/eval-set/coverage-store.js';
import { saveBadcase } from '../src/badcase/badcase-store.js';
import { saveEvalCaseResult } from '../src/judge/eval-result-store.js';
import { saveFinding } from '../src/findings/finding-store.js';

const enabled = process.env.EVALPILOT_DASHBOARD_TEST === '1';

describe.skipIf(!enabled)('dashboard browser', () => {
  let close: (() => Promise<void>) | undefined;
  let baseUrl = '';
  let projectOutputDir = '';

  beforeAll(async () => {
    process.env.EVALPILOT_OPENAI_API_KEY = '';
    const cwd = await mkdtemp(join(tmpdir(), 'evalpilot-dashboard-browser-'));
    const outputDir = resolve(cwd, '.evalpilot-data');
    projectOutputDir = outputDir;
    await mkdir(resolve(outputDir, 'journeys'), { recursive: true });
    await mkdir(resolve(outputDir, 'reports'), { recursive: true });
    await mkdir(resolve(outputDir, 'runs'), { recursive: true });
    await mkdir(resolve(outputDir, 'evaluations', 'evaluation-home'), { recursive: true });
    const now = new Date(); const startedAt = new Date(now.getTime() - 402_000).toISOString(); const completedAt = now.toISOString();
    await writeFile(resolve(outputDir, 'config.yaml'), stringify({ version: 1, projectRoot: cwd, targetUrl: 'http://localhost:3000', outputDir, browser: 'chromium', createdAt: startedAt }));
    await writeFile(resolve(outputDir, 'projects.json'), JSON.stringify({ version: 1, activeProjectId: 'dashboard-fixture', projects: [{ projectId: 'dashboard-fixture', name: 'Dashboard Fixture', projectRoot: cwd, targetUrl: 'http://localhost:3000', outputDir, browser: 'chromium', startCommand: null, status: 'ready', importSource: 'manual', preferredAgent: null, createdAt: startedAt, updatedAt: completedAt, lastOpenedAt: completedAt }] }));
    await writeFile(resolve(outputDir, 'project-background.yaml'), stringify({ projectName: 'Dashboard Fixture', currentStatus: 'verified', problem: '验证非技术工作台', targetUsers: ['产品负责人'], userTasks: ['运行评测'], knownLimitations: [], unknowns: [] }));
    await writeFile(resolve(outputDir, 'eval-blueprint.yaml'), stringify({ projectName: 'Dashboard Fixture', capabilities: [], releaseGates: [], inScope: ['web'], outOfScope: ['native'], approvalStatus: 'approved' }));
    const html = encodeURIComponent(`<html><body><h1>推荐助手</h1><button onclick="document.body.innerHTML='<h1>推荐结果已生成</h1><p>推荐理由清晰可见</p><button>可以保存或修改</button>'">开始智能推荐</button></body></html>`);
    const capability: BlueprintCapability = {
      id: 'cap-recommend', name: '首次推荐', importance: 'critical', userGoals: ['获得推荐并理解推荐理由'],
      entryPoints: [`data:text/html;charset=utf-8,${html}`], successConditions: ['推荐结果已生成', '推荐理由清晰可见', '可以保存或修改'],
      hardConstraints: ['公开保存前必须确认'], failureConditions: ['找不到入口'], dependencies: [], requiredPersonas: ['persona-new-user'],
      requiredInputQualities: ['完整'], requiredSystemStates: ['正常'], graders: ['page_reached'], approvalStatus: 'needs_human_review',
    };
    const blueprint: EvalBlueprint = { projectName: 'Dashboard Fixture', inScope: ['web'], outOfScope: ['native'], capabilities: [capability], scenarioDimensions: { userType: ['new'] }, scoring: { hardAssertions: ['safe'], rubricItems: ['quality'] }, coverageTargets: { critical: 1 }, releaseGates: ['P0=0'], approvalStatus: 'needs_human_review', generatedAt: new Date().toISOString() };
    const persona = buildPersonas()[0]!;
    const exploratory = buildExploratoryScenarios(blueprint, [persona])[0]!;
    await writeFile(resolve(outputDir, 'personas.jsonl'), `${JSON.stringify(persona)}\n`);
    await writeFile(resolve(outputDir, 'scenarios.jsonl'), '{"caseId":"c1","title":"固定案例","goal":"完成任务","persona":"p1","approvalStatus":"approved"}\n');
    await writeFile(resolve(outputDir, 'exploratory-scenarios.jsonl'), `${JSON.stringify(exploratory)}\n`);
    const adaptiveCase: EvalCase = {
      caseId: 'case-baseline-recommend', projectId: 'dashboard-fixture', setType: 'baseline', status: 'stable', origin: { type: 'generated_from_product_model', productModelVersion: 1 }, capabilityId: 'cap-recommend', taskId: 'task-recommend', title: '新用户完成首次推荐', hypothesis: '新用户能获得推荐并理解下一步', persona: { personaId: persona.personaId, name: persona.name, behaviorPolicy: ['只使用可见入口'] }, goal: '获得推荐并理解推荐理由', knownInformation: {}, preconditions: [], oracle: { expectedOutcome: ['推荐结果已生成', '推荐理由清晰可见'], mustObserve: ['推荐结果'], mustNotObserve: ['未处理错误'], businessRules: [], semanticRubric: ['任务完成', '下一步清晰'], deterministicAssertions: [], inconclusiveWhen: ['页面证据不足'] }, coverageDimensions: [{ dimension: 'capability', value: 'cap-recommend' }, { dimension: 'persona', value: persona.personaId }, { dimension: 'journey_stage', value: 'core_task' }, { dimension: 'risk', value: 'critical' }], riskLevel: 'P1', generationReason: 'Dashboard fixture', version: 1, stats: { passCount: 0, failCount: 1, inconclusiveCount: 0, latestResult: 'fail', latestRunId: 'run-adaptive-fail', uniqueCoverageContribution: 4, lastExecutedAt: completedAt }, regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: startedAt, updatedAt: completedAt,
    };
    await saveEvalCase(outputDir, adaptiveCase);
    await saveEvalCase(outputDir, { ...adaptiveCase, caseId: 'case-challenge-recommend', setType: 'challenge', status: 'candidate', origin: { type: 'generated_from_coverage_gap', sourceCaseIds: [adaptiveCase.caseId], gapId: 'gap-persona-returning' }, title: '熟悉用户再次获得推荐', stats: { ...adaptiveCase.stats, failCount: 0, latestResult: null, latestRunId: null, lastExecutedAt: null } });
    await saveCoverageMatrix(outputDir, { projectId: 'dashboard-fixture', generatedAt: completedAt, dimensions: [{ dimension: 'capability', targetValues: ['cap-recommend'], coveredValues: ['cap-recommend'], missingValues: [], coverageRatio: 1 }, { dimension: 'persona', targetValues: [persona.personaId, 'user-returning'], coveredValues: [persona.personaId], missingValues: ['user-returning'], coverageRatio: 0.5 }], gaps: [{ gapId: 'gap-persona-returning', kind: 'missing_asset', capabilityId: 'cap-recommend', dimension: 'persona', missingValue: 'user-returning', priority: 'high', reason: '还没有验证熟悉产品的用户。', candidateCaseIds: [] }], totalTargetCells: 3, assetCoveredCells: 2, executedCells: 2, verifiedCells: 2, coveredCells: 2, assetCoverageRatio: 2 / 3, executionCoverageRatio: 2 / 3, verifiedCoverageRatio: 2 / 3, cells: [{ cellId: 'cell-cap-recommend', capabilityId: 'cap-recommend', dimension: 'capability', value: 'cap-recommend', assetStatus: 'stable', executionStatus: 'pass', caseIds: [adaptiveCase.caseId], latestRunId: 'run-adaptive-pass', latestResultAt: completedAt, verified: true }, { cellId: `cell-persona-${persona.personaId}`, capabilityId: 'cap-recommend', dimension: 'persona', value: persona.personaId, assetStatus: 'stable', executionStatus: 'pass', caseIds: [adaptiveCase.caseId], latestRunId: 'run-adaptive-pass', latestResultAt: completedAt, verified: true }, { cellId: 'cell-persona-returning', capabilityId: 'cap-recommend', dimension: 'persona', value: 'user-returning', assetStatus: 'missing', executionStatus: 'not_run', caseIds: [], latestRunId: null, latestResultAt: null, verified: false }], coverageRatio: 2 / 3 });
    const adaptiveResult: EvalCaseResult = { runId: 'run-adaptive-fail', caseId: adaptiveCase.caseId, verdict: 'fail', failureSource: 'product', severity: 'P1', deterministic: { checks: [], hardFailure: true, severity: 'P1', evidenceRefs: ['step-2.png'] }, semantic: { verdict: 'fail', taskCompletion: 'failed', summary: '推荐已经出现，但用户找不到保存或继续操作。', whatWorked: ['推荐结果已显示'], whatFailed: ['没有下一步'], whyItMatters: ['用户无法确认任务是否完成'], confirmedFacts: ['推荐结果可见', '可见控件中没有保存或继续'], hypotheses: [{ hypothesis: '结果页缺少后续信息架构', confidence: 0.7, supportingEvidence: ['step-2.png'], contradictingEvidence: [], howToVerify: ['检查结果页组件', '增加入口后复测同案例'] }], unknowns: ['无法从模拟判断真实流失'], evidenceRefs: ['step-2.png'], confidence: 0.9 }, evidencePacketPath: 'runs/run-adaptive-fail/evidence-packet.json', createdAt: completedAt };
    await saveEvalCaseResult(outputDir, adaptiveResult);
    await mkdir(resolve(outputDir, 'runs', 'run-adaptive-fail'), { recursive: true });
    await writeFile(resolve(outputDir, 'runs', 'run-adaptive-fail', 'evidence-packet.json'), JSON.stringify({ runId: 'run-adaptive-fail', caseId: adaptiveCase.caseId, targetAppCommit: 'fixture', actorModel: 'evalpilot-mock-v1', actorPromptVersion: '1.0.0', startedAt, completedAt, actions: [{ actionId: 'agent-action-001', type: 'click', timestampMs: 100, page: '/recommend', target: 'E001', inputField: null, inputLength: null, inputFingerprint: null, outcome: '推荐结果已显示', evidence: ['step-1.png'] }, { actionId: 'agent-action-002', type: 'navigation', timestampMs: 200, page: '/result', target: null, inputField: null, inputLength: null, inputFingerprint: null, outcome: '没有找到保存或继续入口', evidence: ['step-2.png'] }], observations: [], stepVerifications: [], screenshots: ['step-1.png', 'step-2.png'], tracePath: null, consoleEvidence: [], networkEvidence: [], finalState: { url: 'http://localhost:3000/result', visibleTextSummary: '推荐结果已生成；推荐理由清晰可见；没有保存或继续按钮。' } }));
    const badcase: Badcase = { badcaseId: 'badcase-next-step', projectId: 'dashboard-fixture', caseId: adaptiveCase.caseId, runId: adaptiveResult.runId, category: 'navigation', title: '推荐结果没有继续入口', observedFailure: '推荐已经出现，但用户找不到保存或继续操作。', userImpact: '用户无法确认任务是否完成，也无法回到主要流程。', severity: 'P1', confirmedFacts: adaptiveResult.semantic.confirmedFacts, rootCauseHypotheses: adaptiveResult.semantic.hypotheses, unknowns: adaptiveResult.semantic.unknowns, evidenceRefs: adaptiveResult.semantic.evidenceRefs, fixStatus: 'open', regressionCaseId: null, createdAt: completedAt, updatedAt: completedAt };
    await saveBadcase(outputDir, badcase);
    await writeFile(resolve(outputDir, 'journeys', 'cap-recommend.yaml'), stringify(buildFeatureJourneyGraph(capability)));
    await writeFile(resolve(outputDir, 'reports', 'ux-issues.jsonl'), '');
    const coverage = { discoveredCount: 1, plannedCount: 1, browserVisitedCount: 1, executedCount: 1, passedCount: 0, failedCount: 1, blockedCount: 0, notApplicableCount: 0, notRunCount: 0, complete: true, capabilities: [{ capabilityId: 'cap-recommend', capabilityName: '首次推荐', entryPoint: '/', discovered: true, browserVisited: true, executionStatus: 'failed', runIds: ['run-home'], reason: '真实运行发现失败' }] };
    await writeFile(resolve(outputDir, 'evaluations', 'sessions.jsonl'), `${JSON.stringify({ evaluationId: 'evaluation-home', projectId: 'dashboard-fixture', sequenceNumber: 1, depth: 'core', capabilityIds: ['cap-recommend'], capabilityNames: ['首次推荐'], plannedCapabilityIds: ['cap-recommend'], plannedCapabilityNames: ['首次推荐'], executedCapabilityIds: ['cap-recommend'], executedCapabilityNames: ['首次推荐'], coverage, customName: null, competitorSnapshotIds: [], issueIds: ['ux-home-1'], status: 'completed', currentStage: 'report', stages: ['readiness','scan','background','blueprint','cases','run','report'].map((name) => ({ name, status: 'completed', message: '完成' })), runIds: ['run-home'], startedAt, completedAt, error: null })}\n`);
    await writeFile(resolve(outputDir, 'evaluations', 'evaluation-home', 'issues.jsonl'), `${JSON.stringify({ issueId: 'ux-home-1', type: 'interaction_feedback_issue', severity: 'P1', featureId: '首次推荐', personaId: 'persona-new-user', caseId: 'case-home', userGoal: '获得推荐结果', idealPath: ['开始', '看到结果'], actualPath: ['开始', '没有反馈'], shortestReasonablePath: ['开始', '看到结果'], failureOrAbandonmentPoint: '提交后没有结果反馈，用户无法确认任务是否完成。', metrics: {}, evidence: ['trace.zip'], recommendation: '补充明确结果反馈', protectedSafetySteps: [], confidence: 'high', needsHumanReview: true, addedToRegression: false })}\n`);
    process.env.EVALPILOT_DATA_DIR = outputDir;
    const server = await startDashboardServer(cwd, 0, resolve(process.cwd(), 'dist-dashboard'));
    close = server.close;
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => { await close?.(); delete process.env.EVALPILOT_DATA_DIR; delete process.env.EVALPILOT_OPENAI_API_KEY; });

  it('shows the guided home, navigates the four-step loop, and remains usable on mobile', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    expect(await page.getByRole('heading', { name: '跟着当前任务往下做' }).isVisible()).toBe(true);
    expect(await page.getByRole('complementary', { name: '上一次评测' }).getByText('Dashboard Fixture').isVisible()).toBe(true);
    expect(await page.getByText('1 个严重问题').isVisible()).toBe(true);
    if (process.env.EVALPILOT_CAPTURE_PUBLIC_SCREENSHOT === '1') {
      await mkdir(resolve(process.cwd(), 'docs', 'assets'), { recursive: true });
      await page.screenshot({ path: resolve(process.cwd(), 'docs', 'assets', 'dashboard.png'), fullPage: true });
    }
    await page.goto(`${baseUrl}/projects`, { waitUntil: 'networkidle' });
    expect(await page.getByRole('heading', { name: '选择要评测的项目' }).isVisible()).toBe(true);
    expect(errors).toEqual([]);
    await page.locator('aside nav button').filter({ hasText: '项目' }).click();
    expect(await page.getByRole('heading', { name: '选择要评测的项目' }).isVisible()).toBe(true);
    await page.getByRole('button', { name: /添加项目/ }).first().click();
    expect(await page.getByRole('dialog', { name: '添加本地项目' }).isVisible()).toBe(true);
    await page.getByRole('button', { name: '取消' }).click();
    for (const [path, heading] of [['/evaluate', '系统已经替你选好评测方案'], ['/issues', '评测发现了什么'], ['/fixes', '生成任务包，再交给 AI 修复']] as const) {
      await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle' });
      const title = page.getByRole('heading', { name: heading, exact: true });
      await title.waitFor({ state: 'visible' });
      expect(await title.isVisible(), `页面标题未显示：${heading}`).toBe(true);
    }
    await page.goto(`${baseUrl}/issues`, { waitUntil: 'networkidle' });
    const resultGuide = page.getByRole('heading', { name: '先看结论，再决定要不要处理' });
    await resultGuide.waitFor({ state: 'visible' });
    expect(await resultGuide.isVisible()).toBe(true);
    expect(await page.getByText('跳过且不扣分').isVisible()).toBe(true);
    expect(await page.getByRole('heading', { name: '实际运行 1 / 1 个计划功能' }).isVisible()).toBe(true);
    expect(await page.getByText('计划 1 · 实际运行 1').isVisible()).toBe(true);
    await page.getByRole('button', { name: '查看分步证据和解决方法' }).click();
    expect(await page.getByText('这是一条旧记录，现有证据不能可靠定位到具体步骤。').isVisible()).toBe(true);
    expect(await page.getByText('尚未定位到具体代码文件').isVisible()).toBe(true);
    await page.getByRole('button', { name: '返回问题列表' }).last().click();
    for (const [label, heading] of [['评测集', '评测集 v2'], ['运行', '运行结果'], ['发现', '问题发现'], ['回归', '回归与评测集演进']] as const) {
      await page.locator('aside nav button').filter({ hasText: label }).click();
      await page.getByRole('heading', { name: heading, exact: true }).waitFor({ state: 'visible' });
    }
    await page.locator('aside nav button').filter({ hasText: '评测集' }).click();
    await page.getByText('评测资产覆盖').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '根据当前产品重新生成' }).click();
    const understandingConsent = page.getByRole('checkbox', { name: /让 AI 深入理解用户任务/ });
    expect(await understandingConsent.isVisible()).toBe(true);
    expect(await understandingConsent.isChecked()).toBe(false);
    expect(await page.getByText(/不发送源码、截图、Trace、密钥或完整页面正文/).isVisible()).toBe(true);
    await page.getByRole('button', { name: '取消' }).click();
    expect(await page.getByText('评测资产覆盖').isVisible()).toBe(true);
    expect(await page.getByText('实际运行覆盖').isVisible()).toBe(true);
    expect(await page.getByText('已验证覆盖', { exact: true }).first().isVisible()).toBe(true);
    expect(await page.getByText('已定义，未运行').isVisible()).toBe(true);
    await page.getByRole('button', { name: '用 AI 用户运行这个案例' }).click();
    expect(await page.getByRole('dialog', { name: '确认运行 AI 用户' }).isVisible()).toBe(true);
    await page.getByRole('button', { name: '确认并开始运行' }).click();
    await page.getByText('尚未配置实验 AI Provider。请在启动 Dashboard 前设置 EVALPILOT_OPENAI_API_KEY。').waitFor({ state: 'visible' });
    expect(await page.getByRole('button', { name: '确认并开始运行' }).isEnabled()).toBe(true);
    await page.getByRole('button', { name: '取消' }).click();
    await page.locator('aside nav button').filter({ hasText: '运行' }).click();
    await page.getByText('推荐已经出现，但用户找不到保存或继续操作。', { exact: true }).waitFor({ state: 'visible' });
    expect(await page.getByText('推荐已经出现，但用户找不到保存或继续操作。', { exact: true }).isVisible()).toBe(true);
    expect(await page.getByText('证据不足，不能判断产品好坏').isVisible()).toBe(true);
    expect(await page.getByText('旧记录缺少逐步前后证据，不能补推验证结论。').isVisible()).toBe(true);
    expect(await page.getByText('没有找到保存或继续入口').isVisible()).toBe(true);
    await page.locator('aside nav button').filter({ hasText: '发现' }).click();
    await page.getByText('已确认事实', { exact: true }).waitFor({ state: 'visible' });
    expect(await page.getByText('已确认事实').isVisible()).toBe(true);
    expect(await page.getByText('可能根因（仍需验证）').isVisible()).toBe(true);
    const candidate: CandidateFinding = { findingId: 'finding-browser-candidate', projectId: 'dashboard-fixture', caseId: 'case-baseline-recommend', runId: 'run-browser-candidate', title: '可疑问题：新用户完成首次推荐', summary: '推荐结果之后可能缺少下一步', status: 'candidate', semanticConfidence: 0.6, deterministicSupport: false, independentEvidenceTypes: ['screenshot'], confirmedFacts: ['推荐结果已显示'], hypotheses: [], unknowns: ['是否属于产品问题'], evidenceRefs: ['step-2.png'], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await saveFinding(projectOutputDir, candidate);
    await page.goto(`${baseUrl}/findings?findingId=${candidate.findingId}`, { waitUntil: 'networkidle' });
    expect(await page.getByRole('heading', { name: '发现可疑问题，证据尚不足' }).isVisible()).toBe(true);
    await page.getByRole('button', { name: '暂不处理' }).click();
    expect(await page.getByRole('dialog', { name: '确认更改问题判断' }).isVisible()).toBe(true);
    await page.getByRole('button', { name: '确认并保存' }).click();
    await page.getByText('已忽略这条发现，不会创建 Badcase。').waitFor({ state: 'visible' });
    expect(errors).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseUrl}/home`, { waitUntil: 'networkidle' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const path of ['/eval-set', '/runs', '/findings', '/regression']) {
      await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle' });
      expect(await page.evaluate(() => ({ root: document.documentElement.scrollWidth, viewport: window.innerWidth, buttons: [...document.querySelectorAll('main button')].filter((button) => { const rect = button.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && (rect.right > window.innerWidth + 1 || rect.left < -1); }).length }))).toEqual({ root: 390, viewport: 390, buttons: 0 });
    }
    await page.goto(`${baseUrl}/home`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '打开主导航' }).click();
    expect(await page.getByRole('navigation', { name: '产品闭环' }).isVisible()).toBe(true);
    await browser.close();
  });
});
