import type { RunResult } from '../../types.js';

export interface DeterministicGrade {
  passed: boolean;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
}

export function gradeRun(result: RunResult): DeterministicGrade {
  const checks = [
    { name: 'browser_status', passed: result.status === 'passed', detail: `运行状态：${result.status}` },
    { name: 'final_url', passed: Boolean(result.finalUrl), detail: result.finalUrl ?? '没有最终 URL' },
    { name: 'step_completion', passed: result.steps.every((step) => step.status === 'passed'), detail: `${result.steps.filter((step) => step.status === 'passed').length}/${result.steps.length} 步通过` },
    { name: 'trace_saved', passed: Boolean(result.trace), detail: result.trace ?? '没有 Trace' },
    { name: 'screenshot_saved', passed: result.screenshots.length > 0, detail: `${result.screenshots.length} 张截图` },
  ];
  return { passed: checks.every((check) => check.passed), checks };
}

