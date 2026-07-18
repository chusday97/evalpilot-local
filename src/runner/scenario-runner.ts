import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { ApiEvidence, EvalPilotConfig, RunResult, Scenario, ScenarioStep, StepResult } from '../../types.js';
import { installFault, parseFaultType, type FaultController } from '../browser/fault-injector.js';
import { recordBrowserErrors } from '../browser/network-recorder.js';
import { scenarioSchema } from '../schemas/scenario.js';
import { EvalPilotError } from '../utils/errors.js';
import { ensureDirectory, pathExists, readJsonLinesFile, writeJsonAtomic } from '../utils/file-system.js';

function safeRunDirectoryName(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function resolveNavigationTarget(target: string | undefined, baseUrl: string): string {
  if (!target) throw new Error('goto 步骤缺少 target');
  if (/^(https?:|data:|about:)/.test(target)) return target;
  return new URL(target, `${baseUrl}/`).toString();
}

async function executeStep(
  step: ScenarioStep,
  page: Page,
  config: EvalPilotConfig,
  faults: FaultController[],
): Promise<string> {
  switch (step.action) {
    case 'injectFault': {
      const pattern = step.target ?? '**/api/**';
      const fault = await installFault(page, pattern, parseFaultType(step.value));
      faults.push(fault);
      return `已配置 ${fault.type} 异常，匹配 ${pattern}`;
    }
    case 'goto': {
      const target = resolveNavigationTarget(step.target, config.targetUrl);
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: step.timeoutMs ?? 15_000 });
      await page.waitForTimeout(250);
      return `已到达 ${page.url()}`;
    }
    case 'click': {
      if (!step.target) throw new Error('click 步骤缺少 target');
      await page.locator(step.target).click({ timeout: step.timeoutMs ?? 5_000 });
      return `已点击 ${step.target}`;
    }
    case 'fill': {
      if (!step.target) throw new Error('fill 步骤缺少 target');
      await page.locator(step.target).fill(step.value ?? '', { timeout: step.timeoutMs ?? 5_000 });
      return `已填写 ${step.target}`;
    }
    case 'press': {
      if (!step.target) throw new Error('press 步骤缺少 target');
      await page.locator(step.target).press(step.value ?? 'Enter', { timeout: step.timeoutMs ?? 5_000 });
      return `已在 ${step.target} 按下 ${step.value ?? 'Enter'}`;
    }
    case 'wait': {
      const timeout = step.timeoutMs ?? Number(step.value ?? 500);
      await page.waitForTimeout(Number.isFinite(timeout) ? timeout : 500);
      return `已等待 ${timeout}ms`;
    }
    case 'assertVisible': {
      if (!step.target) throw new Error('assertVisible 步骤缺少 target');
      await page.locator(step.target).first().waitFor({ state: 'visible', timeout: step.timeoutMs ?? 5_000 });
      return `${step.target} 可见`;
    }
    case 'assertUrl': {
      if (!step.target) throw new Error('assertUrl 步骤缺少 target');
      if (!page.url().includes(step.target)) throw new Error(`当前 URL ${page.url()} 不包含 ${step.target}`);
      return `URL 包含 ${step.target}`;
    }
  }
}

export interface RunScenarioOptions {
  browser?: Browser;
  runDirectory: string;
}

async function apiEvidenceState(config: EvalPilotConfig): Promise<'declared' | 'none' | 'unknown'> {
  const path = resolve(config.outputDir, 'evidence', 'apis.json');
  if (!(await pathExists(path))) return 'unknown';
  try {
    const evidence = JSON.parse(await readFile(path, 'utf8')) as Partial<ApiEvidence>;
    return Array.isArray(evidence.apis) && evidence.apis.length > 0 ? 'declared' : 'none';
  } catch {
    return 'unknown';
  }
}

export function statusForUntriggeredApiFault(apiState: 'declared' | 'none' | 'unknown'): 'blocked' | 'not_applicable' {
  return apiState === 'none' ? 'not_applicable' : 'blocked';
}

export async function runScenario(
  config: EvalPilotConfig,
  rawScenario: Scenario,
  options: RunScenarioOptions,
): Promise<RunResult> {
  const scenario = scenarioSchema.parse(rawScenario);
  const ownBrowser = !options.browser;
  const browser = options.browser ?? (await chromium.launch({ headless: true }));
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  const steps: StepResult[] = [];
  const screenshots: string[] = [];
  const faults: FaultController[] = [];
  const startedAt = Date.now();
  const caseDirectory = resolve(options.runDirectory, scenario.caseId);
  const tracePath = resolve(caseDirectory, 'trace.zip');
  let actualResult = '';
  let status: RunResult['status'] = 'passed';
  let finalUrl: string | null = null;
  let trace: string | null = null;
  let consoleErrors: RunResult['consoleErrors'] = [];
  let networkErrors: RunResult['networkErrors'] = [];

  await ensureDirectory(caseDirectory);
  try {
    if (scenario.automationStatus !== 'automated' || scenario.steps.length === 0) {
      throw new EvalPilotError('案例没有可自动执行步骤，需要人工审核。', 'CASE_NOT_AUTOMATED');
    }
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    page = await context.newPage();
    const recording = recordBrowserErrors(page);
    try {
      for (const step of scenario.steps) {
        try {
          const actual = await executeStep(step, page, config, faults);
          steps.push({ step, status: 'passed', actual });
        } catch (error) {
          steps.push({ step, status: 'failed', actual: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      }
      const untriggeredFaults = faults.filter((fault) => fault.getTriggeredCount() === 0);
      if (untriggeredFaults.length > 0) {
        const apiState = await apiEvidenceState(config);
        status = statusForUntriggeredApiFault(apiState);
        actualResult = apiState === 'none'
          ? '源码扫描和本次页面运行均未发现业务 API，此异常案例不适用于当前项目。'
          : apiState === 'declared'
            ? `页面没有发出匹配请求，${untriggeredFaults.map((fault) => fault.type).join(', ')} 异常未实际注入；项目存在 API 声明，需要确认案例前置条件或实际请求路径。`
            : `页面没有发出匹配请求，${untriggeredFaults.map((fault) => fault.type).join(', ')} 异常未实际注入；尚无可靠 API 扫描证据，需要先完成扫描或确认案例前置条件。`;
      } else {
        actualResult = `全部 ${steps.length} 个自动步骤执行完成。`;
      }
    } finally {
      consoleErrors = [...recording.consoleErrors];
      networkErrors = [...recording.networkErrors];
      recording.dispose();
    }
  } catch (error) {
    if (error instanceof EvalPilotError && error.code === 'CASE_NOT_AUTOMATED') {
      status = 'blocked';
    } else {
      status = 'failed';
    }
    actualResult = error instanceof Error ? error.message : String(error);
  } finally {
    if (page) {
      finalUrl = page.url();
      const screenshotPath = resolve(caseDirectory, status === 'failed' ? 'failure.png' : 'final.png');
      try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
        screenshots.push(screenshotPath);
      } catch (error) {
        actualResult += ` 截图失败：${String(error)}`;
      }
    }
    for (const fault of faults) {
      try {
        await fault.dispose();
      } catch (error) {
        actualResult += ` 清理异常注入失败：${String(error)}`;
      }
    }
    if (context) {
      try {
        await context.tracing.stop({ path: tracePath });
        trace = tracePath;
      } catch (error) {
        actualResult += ` Trace 保存失败：${String(error)}`;
      }
      await context.close();
    }
    if (ownBrowser) await browser.close();
  }

  const result: RunResult = {
    runId: `run-${scenario.caseId}-${Date.now()}`,
    caseId: scenario.caseId,
    steps,
    finalUrl,
    screenshots,
    trace,
    consoleErrors,
    networkErrors,
    durationMs: Date.now() - startedAt,
    actualResult,
    expectedResult: scenario.expectedBehavior,
    status,
    executedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(resolve(caseDirectory, 'result.json'), result);
  return result;
}

export async function runScenarios(config: EvalPilotConfig, caseId?: string, capabilityIds: string[] = []): Promise<{ runDirectory: string; results: RunResult[] }> {
  let scenarios: Scenario[];
  try {
    scenarios = (await readJsonLinesFile<Scenario>(resolve(config.outputDir, 'scenarios.jsonl'))).map((scenario) => scenarioSchema.parse(scenario));
  } catch (error) {
    throw new EvalPilotError(`无法读取评测案例，请先运行 generate-cases。${String(error)}`, 'SCENARIOS_REQUIRED');
  }
  const selected = caseId
    ? scenarios.filter((scenario) => scenario.caseId === caseId)
    : scenarios.filter((scenario) => scenario.automationStatus === 'automated' && (!capabilityIds.length || capabilityIds.includes(scenario.capability)));
  if (selected.length === 0) throw new EvalPilotError(`没有找到可执行案例${caseId ? `：${caseId}` : ''}`, 'CASE_NOT_FOUND');

  const runDirectory = resolve(config.outputDir, 'runs', safeRunDirectoryName(new Date()));
  await ensureDirectory(runDirectory);
  const browser = await chromium.launch({ headless: true });
  const results: RunResult[] = [];
  try {
    for (const scenario of selected) {
      results.push(await runScenario(config, scenario, { browser, runDirectory }));
    }
  } finally {
    await browser.close();
  }
  await writeJsonAtomic(resolve(runDirectory, 'summary.json'), {
    targetUrl: config.targetUrl,
    total: results.length,
    passed: results.filter((result) => result.status === 'passed').length,
    failed: results.filter((result) => result.status === 'failed').length,
    blocked: results.filter((result) => result.status === 'blocked').length,
    notApplicable: results.filter((result) => result.status === 'not_applicable').length,
    results,
    completedAt: new Date().toISOString(),
  });
  return { runDirectory, results };
}
