import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import type { BlueprintCapability, EvalBlueprint, EvalPilotConfig, RegressionCase, Scenario } from '../types.js';
import { buildPersonas } from '../src/generation/persona-builder.js';
import { gradeRun } from '../src/evaluation/deterministic-graders.js';
import { runScenario } from '../src/runner/scenario-runner.js';
import { runRegression } from '../src/runner/regression-runner.js';
import { buildExploratoryScenarios } from '../src/ux-evaluation/exploratory-scenario-builder.js';
import { runExploratoryScenario } from '../src/ux-evaluation/exploratory-runner.js';
import { buildFeatureJourneyGraph } from '../src/ux-evaluation/journey-graph-builder.js';

const browserDescribe = process.env.EVALPILOT_BROWSER_TEST === '1' ? describe : describe.skip;

function scenario(steps: Scenario['steps']): Scenario {
  return {
    caseId: 'case-browser-fixture',
    title: 'runner browser fixture',
    capability: 'cap-fixture',
    persona: 'persona-new-user',
    intentType: '核心功能',
    inputQuality: '完整',
    systemState: 'API 返回空数据',
    journeyStage: '核心任务',
    goal: 'verify runner artifacts',
    preconditions: [],
    input: {},
    steps,
    expectedBehavior: ['page visible'],
    forbiddenBehavior: ['crash'],
    hardAssertions: ['visible'],
    rubric: ['quality'],
    severityIfFailed: 'P1',
    source: 'fixture',
    approvalStatus: 'draft',
    automationStatus: 'automated',
  };
}

browserDescribe('scenario runner', () => {
  it('executes a real page and saves screenshot plus Trace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evalpilot-runner-'));
    const config: EvalPilotConfig = {
      version: 1,
      projectRoot: root,
      targetUrl: 'http://localhost:3000',
      outputDir: root,
      browser: 'chromium',
      createdAt: new Date().toISOString(),
    };
    const page = 'data:text/html,<html><body><h1>Runner works</h1></body></html>';
    const result = await runScenario(config, scenario([{ action: 'goto', target: page }, { action: 'assertVisible', target: 'h1' }]), {
      runDirectory: root,
    });

    expect(result.status).toBe('passed');
    expect(result.screenshots).toHaveLength(1);
    expect(result.trace).toBeTruthy();
    await expect(readFile(result.screenshots[0] as string)).resolves.toBeInstanceOf(Buffer);
    await expect(readFile(result.trace as string)).resolves.toBeInstanceOf(Buffer);
    expect(gradeRun(result).passed).toBe(true);
  });

  it.each(['empty', 'timeout', 'malformed'] as const)('injects %s only when a matching API request occurs', async (faultType) => {
    const root = await mkdtemp(join(tmpdir(), 'evalpilot-fault-'));
    const config: EvalPilotConfig = {
      version: 1,
      projectRoot: root,
      targetUrl: 'http://localhost:3000',
      outputDir: root,
      browser: 'chromium',
      createdAt: new Date().toISOString(),
    };
    const html = encodeURIComponent(`<html><body>loading<script>fetch('https://target.test/api/items').then(r=>r.json()).then(()=>document.body.textContent='resolved').catch(()=>document.body.textContent='recovered')</script></body></html>`);
    const faultScenario = scenario([
      { action: 'injectFault', target: '**/api/**', value: faultType },
      { action: 'goto', target: `data:text/html,${html}` },
      { action: 'wait', timeoutMs: 700 },
      { action: 'assertVisible', target: 'body' },
    ]);
    faultScenario.caseId = `case-fault-${faultType}`;
    const result = await runScenario(
      config,
      faultScenario,
      { runDirectory: root },
    );
    expect(result.status).toBe('passed');
    const saved = JSON.parse(await readFile(resolve(root, `case-fault-${faultType}`, 'result.json'), 'utf8')) as { status: string };
    expect(saved.status).toBe('passed');
  });

  it('marks an untriggered API fault as not applicable when scanning found no business API', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evalpilot-no-api-'));
    await mkdir(resolve(root, 'evidence'), { recursive: true });
    await writeFile(resolve(root, 'evidence', 'apis.json'), JSON.stringify({ apis: [] }));
    const config: EvalPilotConfig = {
      version: 1,
      projectRoot: root,
      targetUrl: 'http://localhost:3000',
      outputDir: root,
      browser: 'chromium',
      createdAt: new Date().toISOString(),
    };
    const noApiScenario = scenario([
      { action: 'injectFault', target: '**/api/**', value: 'empty' },
      { action: 'goto', target: 'data:text/html,<html><body><button>继续</button></body></html>' },
      { action: 'assertVisible', target: 'button' },
    ]);
    noApiScenario.caseId = 'case-no-api';

    const result = await runScenario(config, noApiScenario, { runDirectory: root });

    expect(result.status).toBe('not_applicable');
    expect(result.actualResult).toContain('不适用于当前项目');
    expect(result.steps.every((step) => step.status === 'passed')).toBe(true);
  });

  it('re-runs a confirmed regression case and updates its latest result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evalpilot-regression-'));
    await mkdir(resolve(root, 'regression'), { recursive: true });
    const config: EvalPilotConfig = {
      version: 1,
      projectRoot: root,
      targetUrl: 'http://localhost:3000',
      outputDir: root,
      browser: 'chromium',
      createdAt: new Date().toISOString(),
    };
    const regressionScenario = scenario([
      { action: 'goto', target: 'data:text/html,<html><body><h1>fixed</h1></body></html>' },
      { action: 'assertVisible', target: 'h1' },
    ]);
    regressionScenario.caseId = 'case-regression';
    const regressionCase: RegressionCase = {
      originalIssueId: 'issue-case-regression',
      scenario: regressionScenario,
      fixVersion: 'fixture',
      fixFiles: [],
      expectedResult: ['visible'],
      automatedAssertions: ['h1 visible'],
      lastRunResult: 'failed',
    };
    await writeFile(resolve(root, 'regression', 'regression-cases.jsonl'), `${JSON.stringify(regressionCase)}\n`);

    const run = await runRegression(config);
    expect(run.results).toHaveLength(1);
    expect(run.results[0]?.status).toBe('passed');
    const updated = JSON.parse((await readFile(resolve(root, 'regression', 'regression-cases.jsonl'), 'utf8')).trim()) as RegressionCase;
    expect(updated.lastRunResult).toBe('passed');
  });

  it('explores from a goal without receiving a standard path or selector and saves UX evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evalpilot-exploratory-'));
    await mkdir(resolve(root, 'journeys'), { recursive: true });
    await mkdir(resolve(root, 'reports'), { recursive: true });
    const html = encodeURIComponent(`<html><body><h1>推荐助手</h1><button onclick="document.body.innerHTML='<h1>推荐结果已生成</h1><p>推荐理由清晰可见</p><button>可以保存或修改</button>'">开始智能推荐</button></body></html>`);
    const capability: BlueprintCapability = {
      id: 'cap-recommend', name: '首次推荐', importance: 'critical',
      userGoals: ['获得推荐并理解推荐理由'], entryPoints: [`data:text/html;charset=utf-8,${html}`],
      successConditions: ['推荐结果已生成', '推荐理由清晰可见', '可以保存或修改'],
      hardConstraints: ['公开保存前必须确认'], failureConditions: ['找不到入口'], dependencies: [],
      requiredPersonas: ['persona-new-user'], requiredInputQualities: ['完整'], requiredSystemStates: ['正常'],
      graders: ['page_reached'], approvalStatus: 'needs_human_review',
    };
    const blueprint: EvalBlueprint = {
      projectName: 'Explorer fixture', inScope: ['web'], outOfScope: ['native'], capabilities: [capability],
      scenarioDimensions: { userType: ['new'] }, scoring: { hardAssertions: ['safe'], rubricItems: ['quality'] },
      coverageTargets: { critical: 1 }, releaseGates: ['P0=0'], approvalStatus: 'needs_human_review',
      generatedAt: new Date().toISOString(),
    };
    const persona = buildPersonas()[0];
    if (!persona) throw new Error('fixture persona missing');
    const exploratory = buildExploratoryScenarios(blueprint, [persona])[0];
    if (!exploratory) throw new Error('fixture exploratory scenario missing');
    await writeFile(resolve(root, 'personas.jsonl'), `${JSON.stringify(persona)}\n`);
    await writeFile(resolve(root, 'exploratory-scenarios.jsonl'), `${JSON.stringify(exploratory)}\n`);
    await writeFile(resolve(root, 'journeys', 'cap-recommend.yaml'), stringify(buildFeatureJourneyGraph(capability)));
    const config: EvalPilotConfig = {
      version: 1, projectRoot: root, targetUrl: 'http://localhost:3000', outputDir: root,
      browser: 'chromium', createdAt: new Date().toISOString(),
    };

    const run = await runExploratoryScenario(config, exploratory.caseId);

    expect(run.metrics.taskCompleted).toBe(true);
    expect(run.metrics.fullLoopCompleted).toBe(true);
    expect(run.actions.some((action) => action.target === '开始智能推荐')).toBe(true);
    expect(JSON.stringify(run.actions)).not.toContain('selector');
    await expect(readFile(resolve(run.runDirectory, 'interactions.jsonl'), 'utf8')).resolves.toContain('开始智能推荐');
    await expect(readFile(resolve(run.runDirectory, 'ux-evaluation.json'), 'utf8')).resolves.toContain('functionalStatus');
    await expect(readFile(resolve(root, 'reports', 'LATEST_UX_REPORT.md'), 'utf8')).resolves.toContain('真实性声明');
  });
});
