import type { BadcaseCategory, BenchmarkFixture, BenchmarkObservation, Severity } from '../../types.js';
import { benchmarkFixtureSchema } from '../eval-set/schemas.js';

const cleanObservation: BenchmarkObservation = {
  interactionAttempted: true,
  stableFeedback: true,
  urlChanged: true,
  statePersisted: true,
  networkStatus: 200,
  duplicateRequests: 1,
  nextActionVisible: true,
  timedOut: false,
  aiOutputRelevant: true,
  destructiveActionBlocked: true,
};

const templates: Array<{ id: string; title: string; category: BadcaseCategory; severity: Severity; failure: Partial<BenchmarkObservation>; summary: string }> = [
  { id: 'dead-click', title: '按钮点击没有任何稳定变化', category: 'interaction', severity: 'P1', failure: { stableFeedback: false, urlChanged: false }, summary: '操作后没有稳定反馈或页面变化。' },
  { id: 'no-feedback', title: '提交成功但没有结果反馈', category: 'interaction', severity: 'P1', failure: { stableFeedback: false, urlChanged: false }, summary: '提交后用户无法确认结果。' },
  { id: 'state-loss', title: '刷新后用户状态丢失', category: 'state', severity: 'P1', failure: { statePersisted: false }, summary: '刷新后已完成状态没有保留。' },
  { id: 'api-500', title: '核心请求返回 500', category: 'api', severity: 'P1', failure: { networkStatus: 500 }, summary: '核心请求返回服务器错误。' },
  { id: 'duplicate-submit', title: '一次提交产生重复请求', category: 'interaction', severity: 'P1', failure: { duplicateRequests: 2 }, summary: '一次用户操作触发多次提交。' },
  { id: 'timeout', title: '核心任务等待超时', category: 'performance', severity: 'P1', failure: { timedOut: true }, summary: '用户在可接受时间内没有得到结果。' },
  { id: 'unclear-next-step', title: '结果页没有下一步', category: 'navigation', severity: 'P1', failure: { nextActionVisible: false }, summary: '任务结果出现后没有可见的继续路径。' },
  { id: 'ai-irrelevant-output', title: 'AI 输出与用户目标无关', category: 'ai_output', severity: 'P1', failure: { aiOutputRelevant: false }, summary: 'AI 输出没有回应用户当前目标。' },
  { id: 'destructive-unblocked', title: '危险操作没有被阻止', category: 'safety', severity: 'P0', failure: { destructiveActionBlocked: false }, summary: '危险操作在没有确认时可以继续。' },
  { id: 'network-recovery', title: '错误后没有恢复路径', category: 'navigation', severity: 'P1', failure: { networkStatus: 503, nextActionVisible: false }, summary: '服务失败后没有重试或返回入口。' },
];

function issueId(fixtureId: string, category: BadcaseCategory): string { return `issue-${fixtureId}-${category}`; }

export function builtinBenchmarkFixtures(): BenchmarkFixture[] {
  const failures = templates.flatMap((template) => [1, 2].map((variant) => {
    const fixtureId = `fixture-${template.id}-fail-${variant}`;
    return benchmarkFixtureSchema.parse({
      groundTruth: { fixtureId, expectedIssues: [{ issueId: issueId(fixtureId, template.category), category: template.category, severity: template.severity, summary: template.summary }], forbiddenFalsePositives: [] },
      title: `${template.title}（失败变体 ${variant}）`,
      observation: { ...cleanObservation, ...template.failure },
    });
  }));
  const clean = templates.flatMap((template) => [1, 2].map((variant) => {
    const fixtureId = `fixture-${template.id}-clean-${variant}`;
    return benchmarkFixtureSchema.parse({
      groundTruth: { fixtureId, expectedIssues: [], forbiddenFalsePositives: [template.category] },
      title: `${template.title}（预期行为 ${variant}）`,
      observation: cleanObservation,
    });
  }));
  return [...failures, ...clean];
}

export { issueId as benchmarkIssueId };
