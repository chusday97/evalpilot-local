import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PageEvidence, RunResult } from '../types.js';
import { initializeProject } from '../src/config/initializer.js';
import { scanProject } from '../src/scanner/scan-project.js';
import { generateBackground } from '../src/generation/background-builder.js';
import { generateBlueprint } from '../src/generation/blueprint-builder.js';
import { generateCases } from '../src/generation/scenario-builder.js';
import { buildReport } from '../src/report/report-builder.js';

const successfulFetch = (() => Promise.resolve(new Response('ok', { status: 200 }))) as typeof fetch;

describe('local evaluation pipeline integration', () => {
  it('initializes, scans, generates all definitions, and builds a report', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evalpilot-pipeline-'));
    const cwd = resolve(root, 'evalpilot');
    const projectRoot = resolve(root, 'target');
    await mkdir(cwd);
    await mkdir(resolve(projectRoot, 'src'), { recursive: true });
    await mkdir(resolve(projectRoot, 'tests'), { recursive: true });
    await writeFile(resolve(projectRoot, 'package.json'), JSON.stringify({
      name: 'pipeline-fixture',
      scripts: { test: 'vitest run' },
      dependencies: { react: '1.0.0', vite: '1.0.0' },
      devDependencies: { vitest: '1.0.0' },
    }));
    await writeFile(resolve(projectRoot, 'README.md'), '# Pipeline Fixture\n\nA declared fixture product.');
    await writeFile(resolve(projectRoot, 'src', 'router.tsx'), `<Route path="/" element={<Home />} />\nfetch('/api/items')`);
    await writeFile(resolve(projectRoot, 'tests', 'home.test.ts'), 'it("renders", () => {})');

    const config = await initializeProject({
      cwd,
      project: projectRoot,
      url: 'http://localhost:3000',
      outputDir: resolve(cwd, '.evalpilot'),
      fetchImplementation: successfulFetch,
    });
    const page: PageEvidence = {
      url: config.targetUrl,
      title: 'Pipeline Fixture',
      visibleText: 'Start evaluation',
      links: [],
      buttons: [{ text: 'Start', risk: 'safe' }],
      inputs: [],
      forms: 0,
      dialogs: 0,
      accessibility: { lang: 'en', headings: ['Pipeline Fixture'], imageAltMissing: 0 },
      screenshot: resolve(config.outputDir, 'evidence', 'screenshots', 'page-01.png'),
      consoleErrors: [],
      networkErrors: [],
      exploredAt: new Date().toISOString(),
    };
    const scan = await scanProject(config, async () => [page]);
    const background = await generateBackground(config);
    const blueprint = await generateBlueprint(config);
    const generated = await generateCases(config);

    const scenario = generated.scenarios.find((item) => item.automationStatus === 'automated');
    expect(scenario).toBeDefined();
    const runResult: RunResult = {
      runId: 'run-integration',
      caseId: scenario?.caseId ?? 'missing',
      steps: [],
      finalUrl: config.targetUrl,
      screenshots: [page.screenshot as string],
      trace: resolve(config.outputDir, 'runs', 'integration', 'trace.zip'),
      consoleErrors: [],
      networkErrors: [],
      durationMs: 5,
      actualResult: '核心入口真实结果由浏览器 runner 单独验证；本集成夹具验证文件流水线。',
      expectedResult: scenario?.expectedBehavior ?? [],
      status: 'passed',
      executedAt: new Date().toISOString(),
    };
    const runDirectory = resolve(config.outputDir, 'runs', 'integration');
    await mkdir(runDirectory, { recursive: true });
    await writeFile(resolve(runDirectory, 'summary.json'), JSON.stringify({
      targetUrl: config.targetUrl,
      total: 1,
      passed: 1,
      failed: 0,
      blocked: 0,
      results: [runResult],
      completedAt: new Date().toISOString(),
    }));
    const report = await buildReport(config);

    expect(scan).toMatchObject({ routeCount: 1, apiCount: 1, testFileCount: 1, pageCount: 1 });
    expect(background.fieldStatuses.targetUsers).toBe('unknown');
    expect(blueprint.capabilities[0]?.requiredInputQualities).toContain('模糊');
    expect(generated.personas).toHaveLength(8);
    expect(generated.scenarios).toHaveLength(40);
    expect(generated.journeys).toHaveLength(1);
    expect(generated.exploratoryScenarios).toHaveLength(8);
    expect(report.recommendation).toBe('可以上线');
    await expect(readFile(resolve(config.outputDir, 'taxonomy.yaml'), 'utf8')).resolves.toContain('expectedHandling');
    await expect(readFile(resolve(config.outputDir, 'journeys', `${blueprint.capabilities[0]?.id}.yaml`), 'utf8')).resolves.toContain('completionDefinition');
    await expect(readFile(resolve(config.outputDir, 'exploratory-scenarios.jsonl'), 'utf8')).resolves.not.toContain('primaryPath');
    await expect(readFile(resolve(config.outputDir, 'reports', 'LATEST_REPORT.md'), 'utf8')).resolves.toContain('可以上线');
  });
});
