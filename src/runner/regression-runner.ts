import { resolve } from 'node:path';
import { chromium } from 'playwright';
import type { EvalPilotConfig, RegressionCase, RunResult } from '../../types.js';
import { EvalPilotError } from '../utils/errors.js';
import { ensureDirectory, readJsonLinesFile, writeJsonAtomic, writeJsonLinesAtomic } from '../utils/file-system.js';
import { runScenario } from './scenario-runner.js';

export async function runRegression(config: EvalPilotConfig): Promise<{ runDirectory: string; results: RunResult[] }> {
  const regressionPath = resolve(config.outputDir, 'regression', 'regression-cases.jsonl');
  let cases: RegressionCase[];
  try {
    cases = await readJsonLinesFile<RegressionCase>(regressionPath);
  } catch (error) {
    throw new EvalPilotError(`无法读取回归案例：${String(error)}`, 'REGRESSION_READ_FAILED');
  }
  if (cases.length === 0) throw new EvalPilotError('当前没有已确认的失败回归案例。', 'NO_REGRESSION_CASES');
  const runDirectory = resolve(config.outputDir, 'runs', `regression-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await ensureDirectory(runDirectory);
  const browser = await chromium.launch({ headless: true });
  const results: RunResult[] = [];
  try {
    for (const regressionCase of cases) {
      const result = await runScenario(config, regressionCase.scenario, { browser, runDirectory });
      regressionCase.lastRunResult = result.status;
      results.push(result);
    }
  } finally {
    await browser.close();
  }
  await Promise.all([
    writeJsonLinesAtomic(regressionPath, cases),
    writeJsonAtomic(resolve(runDirectory, 'summary.json'), {
      regression: true,
      total: results.length,
      passed: results.filter((result) => result.status === 'passed').length,
      failed: results.filter((result) => result.status === 'failed').length,
      blocked: results.filter((result) => result.status === 'blocked').length,
      notApplicable: results.filter((result) => result.status === 'not_applicable').length,
      results,
      completedAt: new Date().toISOString(),
    }),
  ]);
  return { runDirectory, results };
}
