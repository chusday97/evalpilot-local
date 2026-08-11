export interface EvaluatorRegressionFixture {
  id: string;
  sourceFailure: string;
  productionDurationMs: number | null;
  expected: string;
}

export const evaluatorRegressionFixtures = [
  { id: 'slow-ai-generation-10s', sourceFailure: 'AI 生成仍在正常等待时被提前判失败', productionDurationMs: 10_000, expected: '完成且等待期间不消耗 Persona 失败次数' },
  { id: 'streaming-output-20s', sourceFailure: '流式输出被固定等待窗口截断', productionDurationMs: 20_000, expected: '持续识别进展并最终识别完成' },
  { id: 'loading-with-no-new-button', sourceFailure: '加载期间没有新按钮而被判为无下一动作', productionDurationMs: null, expected: '保持 pending，不生成 no_next_action' },
  { id: 'stalled-generation', sourceFailure: '永久加载被误报为产品 UX 失败', productionDurationMs: null, expected: 'pending 后进入 stalled，并交给评测器恢复' },
  { id: 'issue-snapshot-fix-handoff', sourceFailure: '后一次评测覆盖前一次问题的修复来源', productionDurationMs: null, expected: 'FixTask 永久绑定 Evaluation A 的问题快照' },
  { id: 'stale-global-issue-file', sourceFailure: 'Legacy 全局问题文件改变已创建修复任务', productionDurationMs: null, expected: '全局文件变化不影响 FixTask' },
  { id: 'no-product-bug-next-action', sourceFailure: '评测器失败时错误引导用户修代码', productionDurationMs: null, expected: '唯一主动作是重新评测' },
  { id: 'confirmed-product-bug-next-action', sourceFailure: '已确认产品失败后修复入口含糊', productionDurationMs: null, expected: '唯一主动作是生成 Codex 修复任务' },
  { id: 'pending-does-not-consume-persona', sourceFailure: '15 秒正常生成耗尽低耐心 Persona', productionDurationMs: 15_000, expected: '等待期间 failedAttempts 保持 0' },
  { id: 'progress-resets-stall-clock', sourceFailure: '持续变化的流式任务仍按初始时刻停滞', productionDurationMs: 20_000, expected: 'lastProgressAtMs 持续前移且不提前 stalled' },
] as const satisfies readonly EvaluatorRegressionFixture[];

export const fixtureById = (id: typeof evaluatorRegressionFixtures[number]['id']) => {
  const fixture = evaluatorRegressionFixtures.find((item) => item.id === id);
  if (!fixture) throw new Error(`Unknown evaluator regression fixture: ${id}`);
  return fixture;
};

// CI uses accelerated browser fixtures while preserving the production duration as metadata above.
export const regressionTimeScale = process.env.EVALPILOT_REGRESSION_REAL_TIME === '1' ? 1 : 0.04;
