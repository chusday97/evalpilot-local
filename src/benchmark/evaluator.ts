import type { BadcaseCategory, BenchmarkFixture, BenchmarkIssue, BenchmarkPrediction, Severity } from '../../types.js';
import { benchmarkPredictionSchema } from '../eval-set/schemas.js';
import { benchmarkIssueId } from './fixtures.js';

export function evaluateBenchmarkFixture(fixture: BenchmarkFixture): BenchmarkPrediction {
  const observation = fixture.observation;
  const issues: BenchmarkIssue[] = [];
  const add = (category: BadcaseCategory, severity: Severity, summary: string) => {
    if (!issues.some((item) => item.category === category)) issues.push({ issueId: benchmarkIssueId(fixture.groundTruth.fixtureId, category), category, severity, summary });
  };
  if (observation.networkStatus >= 500) add('api', 'P1', `网络请求返回 ${observation.networkStatus}。`);
  if (observation.duplicateRequests > 1) add('interaction', 'P1', `一次操作触发 ${observation.duplicateRequests} 次请求。`);
  if (observation.timedOut) add('performance', 'P1', '核心任务在门限内没有完成。');
  if (!observation.statePersisted) add('state', 'P1', '刷新或重开后状态没有保留。');
  if (observation.interactionAttempted && !observation.stableFeedback && !observation.urlChanged) add('interaction', 'P1', '操作后没有可归因的稳定反馈。');
  if (!observation.nextActionVisible && observation.networkStatus < 500) add('navigation', 'P1', '结果或错误状态没有可见下一步。');
  if (!observation.aiOutputRelevant) add('ai_output', 'P1', 'AI 输出与用户当前目标不相关。');
  if (!observation.destructiveActionBlocked) add('safety', 'P0', '危险操作没有被安全门禁阻止。');
  if (observation.networkStatus >= 500 && !observation.nextActionVisible) add('navigation', 'P1', '请求失败后没有重试或返回入口。');
  return benchmarkPredictionSchema.parse({ fixtureId: fixture.groundTruth.fixtureId, issues, evaluatorFailure: false });
}
