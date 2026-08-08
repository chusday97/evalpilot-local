import type { AiProvider } from '../ai/provider.js';
import type { DeterministicAssertion, EvalOracle, ProductModel, ProductTask } from '../../types.js';
import { oracleBuilderPromptV1 } from '../prompts/oracle-builder.v1.js';
import { evalOracleSchema, oracleBuilderOutputSchema } from './schemas.js';

export interface OracleBuildResult {
  oracle: EvalOracle;
  needsHumanReview: boolean;
  reviewReasons: string[];
  mode: 'ai' | 'deterministic_fallback';
  warnings: string[];
}

const supportedAssertionTypes = new Set<DeterministicAssertion['type']>(['url_matches', 'text_visible', 'text_absent', 'request_observed', 'console_error_absent', 'state_persisted']);

function assertionForSignal(signal: NonNullable<ProductTask['successSignals']>[number]): DeterministicAssertion | null {
  if (signal.kind === 'semantic') return null;
  return {
    assertionId: `assert-${signal.signalId}`,
    type: signal.kind,
    target: signal.target,
    expected: true,
    negated: false,
  };
}

export function buildDeterministicOracle(model: ProductModel, task: ProductTask): OracleBuildResult {
  const capability = model.capabilities.find((item) => item.capabilityId === task.capabilityId);
  if (!capability) throw new Error(`Product Model 缺少任务 ${task.taskId} 对应的能力。`);
  const signals = task.successSignals ?? [];
  const deterministicAssertions = signals.flatMap((signal) => {
    const assertion = assertionForSignal(signal);
    return assertion ? [assertion] : [];
  });
  const relevantRules = task.businessRuleIds ? model.businessRules.filter((item) => task.businessRuleIds?.includes(item.ruleId)) : model.businessRules;
  const businessRules = relevantRules.map((item) => item.statement);
  const reviewReasons = [
    task.needsHumanReview ? '任务定义需要人工确认。' : null,
    capability.needsHumanReview ? '能力范围需要人工确认。' : null,
    signals.some((signal) => signal.needsHumanReview || signal.evidenceStatus === 'inferred' || signal.evidenceStatus === 'unknown') ? '至少一个成功信号来自推断或未知证据。' : null,
    relevantRules.some((rule) => rule.needsHumanReview || rule.evidenceStatus === 'inferred' || rule.evidenceStatus === 'unknown') ? '至少一条业务规则需要人工确认。' : null,
  ].filter((reason): reason is string => Boolean(reason));
  const mustObserve = signals.filter((signal) => signal.kind === 'text_visible').map((signal) => signal.target);
  const mustNotObserve = signals.filter((signal) => signal.kind === 'text_absent').map((signal) => signal.target);
  const semanticSignals = signals.filter((signal) => signal.kind === 'semantic').map((signal) => signal.description);
  const oracle = evalOracleSchema.parse({
    expectedOutcome: task.successConditions.length ? task.successConditions : ['用户能看到明确结果或下一步'],
    mustObserve,
    mustNotObserve: [...new Set([...mustNotObserve, '未处理错误', '未经确认的高风险操作'])],
    businessRules,
    semanticRubric: semanticSignals.length ? semanticSignals : [`用户是否真正完成：${task.goal}`, '结果和下一步是否清晰可理解'],
    deterministicAssertions,
    inconclusiveWhen: ['目标服务不可用', '浏览器或评测器证据不完整', '业务规则仍待人工确认且会改变结论'],
  });
  return { oracle, needsHumanReview: reviewReasons.length > 0, reviewReasons, mode: 'deterministic_fallback', warnings: [] };
}

export async function buildOracleWithAgent(input: {
  model: ProductModel;
  task: ProductTask;
  provider: AiProvider;
  allowRemoteModel?: boolean;
}): Promise<OracleBuildResult> {
  const fallback = buildDeterministicOracle(input.model, input.task);
  const capability = input.model.capabilities.find((item) => item.capabilityId === input.task.capabilityId);
  if (!capability) return fallback;
  const relevantRules = input.task.businessRuleIds ? input.model.businessRules.filter((rule) => input.task.businessRuleIds?.includes(rule.ruleId)) : input.model.businessRules;
  const prompt = oracleBuilderPromptV1.build({ task: input.task, capability, businessRules: relevantRules });
  try {
    const draft = await input.provider.generateStructured({
      requestId: `oracle-builder-${input.task.taskId}`,
      task: 'oracle_builder',
      systemPrompt: prompt.system,
      userPrompt: prompt.user,
      schemaName: 'oracle_builder_output',
      imageDataUrls: [],
      privacy: { allowRemoteModel: input.provider.info.remote ? input.allowRemoteModel === true : true, allowScreenshot: false, visibleTextOnly: true, redactionApplied: true },
      metadata: { taskId: input.task.taskId, productModelVersion: input.model.version, promptVersion: oracleBuilderPromptV1.version },
    }, oracleBuilderOutputSchema);
    const supportedSignals = new Map((input.task.successSignals ?? []).filter((signal) => signal.kind !== 'semantic').map((signal) => [`${signal.kind}|${signal.target}`, signal]));
    const deterministicAssertions = draft.deterministicAssertions.filter((assertion) => supportedAssertionTypes.has(assertion.type) && supportedSignals.has(`${assertion.type}|${assertion.target}`));
    const allowedRules = new Set(relevantRules.map((rule) => rule.statement));
    const businessRules = draft.businessRules.filter((rule) => allowedRules.has(rule));
    const observableText = new Set((input.task.successSignals ?? []).filter((signal) => signal.kind === 'text_visible').flatMap((signal) => [signal.target, signal.description]));
    const forbiddenText = new Set((input.task.successSignals ?? []).filter((signal) => signal.kind === 'text_absent').flatMap((signal) => [signal.target, signal.description]));
    const allowedOutcomes = new Set([input.task.goal, ...input.task.successConditions, ...(input.task.successSignals ?? []).flatMap((signal) => [signal.target, signal.description])]);
    const expectedOutcome = draft.expectedOutcome.filter((item) => allowedOutcomes.has(item));
    const mustObserve = draft.mustObserve.filter((item) => observableText.has(item));
    const mustNotObserve = draft.mustNotObserve.filter((item) => forbiddenText.has(item) || item === '未处理错误' || item === '未经确认的高风险操作');
    const reviewReasons = [...new Set([...fallback.reviewReasons, ...draft.reviewReasons])];
    const warnings = [
      draft.deterministicAssertions.length !== deterministicAssertions.length ? 'Oracle 中无对应任务信号的确定性断言已过滤。' : null,
      draft.businessRules.length !== businessRules.length ? 'Oracle 中未在 Product Model 声明的业务规则已过滤。' : null,
      draft.mustObserve.length !== mustObserve.length || draft.mustNotObserve.length !== mustNotObserve.length ? 'Oracle 中缺少任务信号支持的观察项已过滤。' : null,
      draft.expectedOutcome.length !== expectedOutcome.length ? 'Oracle 中未由任务定义或成功信号支持的预期结果已过滤。' : null,
    ].filter((warning): warning is string => Boolean(warning));
    const oracle = evalOracleSchema.parse({
      expectedOutcome: expectedOutcome.length ? expectedOutcome : fallback.oracle.expectedOutcome,
      mustObserve,
      mustNotObserve,
      businessRules,
      semanticRubric: draft.semanticRubric,
      deterministicAssertions,
      inconclusiveWhen: draft.inconclusiveWhen,
    });
    return { oracle, needsHumanReview: draft.needsHumanReview || fallback.needsHumanReview, reviewReasons, mode: 'ai', warnings };
  } catch (error) {
    return { ...fallback, warnings: [`Oracle Builder 未完成，已使用确定性结果：${error instanceof Error ? error.message : String(error)}`] };
  }
}
