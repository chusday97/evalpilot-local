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

const enabled = process.env.EVALPILOT_DASHBOARD_TEST === '1';

describe.skipIf(!enabled)('dashboard browser', () => {
  let close: (() => Promise<void>) | undefined;
  let baseUrl = '';

  beforeAll(async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'evalpilot-dashboard-browser-'));
    const outputDir = resolve(cwd, '.evalpilot-data');
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

  afterAll(async () => { await close?.(); delete process.env.EVALPILOT_DATA_DIR; });

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
    for (const [label, heading] of [['评测', '系统已经替你选好评测方案'], ['问题', '评测发现了什么'], ['修复', '生成任务包，再交给 AI 修复']] as const) {
      await page.locator('aside nav button').filter({ hasText: label }).click();
      const title = page.getByRole('heading', { name: heading, exact: true });
      await title.waitFor({ state: 'visible' });
      expect(await title.isVisible(), `页面标题未显示：${heading}`).toBe(true);
    }
    await page.locator('aside nav button').filter({ hasText: '问题' }).click();
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
    expect(errors).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseUrl}/home`, { waitUntil: 'networkidle' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: '打开主导航' }).click();
    expect(await page.getByRole('navigation', { name: '产品闭环' }).isVisible()).toBe(true);
    await browser.close();
  });
});
