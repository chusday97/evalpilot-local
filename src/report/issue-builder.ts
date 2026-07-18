import type { Issue, RunResult, Scenario } from '../../types.js';
import { classifySeverity } from '../evaluation/severity-classifier.js';

export function buildIssue(result: RunResult, scenario: Scenario): Issue | null {
  if (result.status === 'passed' || result.status === 'not_applicable') return null;
  const blocked = result.status === 'blocked';
  return {
    issueId: `issue-${result.caseId}`,
    severity: classifySeverity(result, scenario),
    capability: scenario.capability,
    persona: scenario.persona,
    caseId: scenario.caseId,
    title: blocked ? `评测阻塞：${scenario.title}` : `评测失败：${scenario.title}`,
    reproductionSteps: scenario.steps.map((step) =>
      [step.action, step.target, step.value].filter((value) => value !== undefined).join(' '),
    ),
    expectedResult: scenario.expectedBehavior,
    actualResult: result.actualResult,
    userImpact: blocked
      ? '当前无法完成该覆盖维度，不能据此判断产品在该异常状态下是否可安全恢复。'
      : `用户无法可靠完成“${scenario.goal}”。`,
    screenshots: result.screenshots,
    trace: result.trace,
    consoleErrors: result.consoleErrors,
    networkErrors: result.networkErrors,
    possibleCause: blocked ? '目标页面未满足案例前置条件，或没有发出预期 API 请求。' : '需要结合 Trace、控制台、网络和目标代码进一步定位。',
    suggestedLocation: blocked ? '评测案例前置条件、页面实际数据流和 API 路径' : `能力 ${scenario.capability} 对应页面与服务层`,
    addedToRegression: false,
  };
}
