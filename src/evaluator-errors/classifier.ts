import type { AiTestAgentRun, EvalCase, EvalCaseResult, EvaluatorBadcase, EvidencePacket } from '../../types.js';
import { evalCaseResultSchema } from '../judge/schemas.js';
import type { EvaluatorFailureClassification } from './types.js';

export const EVALUATOR_FAILURE_USER_SUMMARY = 'EvalPilot 暂时无法确定下一步操作。\n当前没有足够证据判断这是产品问题。';
export const EVALUATOR_FAILURE_POSSIBLE_REASONS = [
  '页面仍在处理',
  '下一步入口不明显',
  '当前评测器没有理解这个页面',
] as const;

function runText(run: AiTestAgentRun, result: EvalCaseResult): string {
  return [
    run.error,
    ...run.decisions.flatMap((item) => [item.intentSummary, item.expectedResult]),
    ...run.actionResults.map((item) => item.summary),
    ...run.reflections.map((item) => item.summary),
    result.semantic.summary,
    ...result.semantic.unknowns,
  ].filter(Boolean).join(' ');
}

function hasWaitExhaustion(packet: EvidencePacket): boolean {
  return packet.stepEvidence.some((item) => item.taskWait
    && ['soft_timeout', 'hard_timeout'].includes(item.taskWait.finalReason)
    && !['failed', 'blocked'].includes(item.taskState?.state ?? ''));
}

function isRuntimeCrash(error: string | null): boolean {
  return Boolean(error && /playwright|locator\.|page\.|browser\.|referenceerror|typeerror|execution context|target closed|frame was detached|__name/i.test(error));
}

export function classifyEvaluatorFailure(input: {
  agentRun: AiTestAgentRun;
  packet: EvidencePacket;
  result: EvalCaseResult;
}): EvaluatorFailureClassification | null {
  if (input.result.verdict === 'pass') return null;
  const text = runText(input.agentRun, input.result);
  const failedAction = input.agentRun.actionResults.find((item) => item.status === 'failed');
  const blockedAction = input.agentRun.actionResults.find((item) => item.status === 'blocked_by_safety');
  const noNextAction = /no[_ -]?next[_ -]?action|没有.{0,8}(下一步|安全.{0,4}操作)|无法.{0,8}(下一步|继续操作)/i.test(text);
  const unsupportedControl = Boolean(blockedAction) || /unsupported.{0,12}(control|element)|不支持.{0,8}(控件|元素|操作)|目标元素不存在|元素.{0,6}(消失|不可用)/i.test(text);
  const modelOutputInvalid = /model.{0,12}(output|response).{0,12}(invalid|malformed)|schema.{0,12}(invalid|error)|invalid.{0,12}(json|output)|模型输出.{0,8}(无效|损坏)|输出无效|结构化输出.{0,8}(失败|无效)/i.test(text);
  const navigationMismatch = /navigation.{0,12}mismatch|route.{0,12}mismatch|导航.{0,8}不匹配|路由.{0,8}不匹配|预期.{0,8}(地址|URL|页面).{0,8}(不符|未到达)/i.test(text);
  const explicitEvaluatorFailure = input.result.failureSource === 'evaluator' || input.agentRun.failureSource === 'evaluator';
  const runtimeCrash = input.agentRun.failureSource === 'evaluator' && isRuntimeCrash(input.agentRun.error);

  // Preserve specific evaluator diagnoses first. Only a concrete browser/tool runtime crash
  // may override deterministic assertions from a partial page. Generic evaluator errors such
  // as action-budget exhaustion can be downstream of a genuine product defect and must not
  // erase evidence-complete Product Failure signals.
  if (!input.packet.evidenceCompleteness.complete) return { category: 'evidence_missing', technicalReason: input.packet.evidenceCompleteness.missing.join(' ') };
  if (modelOutputInvalid) return { category: 'model_output_invalid', technicalReason: input.agentRun.error ?? '模型输出未通过结构校验。' };
  if (unsupportedControl) return { category: 'unsupported_control', technicalReason: blockedAction?.summary ?? '当前控件不在评测器可安全执行的范围内。' };
  if (navigationMismatch) return { category: 'navigation_mismatch', technicalReason: '实际页面与评测器预期的导航目标不一致。' };
  if (failedAction) return { category: 'tool_execution_error', technicalReason: failedAction.summary };
  if (runtimeCrash) return { category: 'tool_execution_error', technicalReason: input.agentRun.error! };

  if (input.packet.evidenceCompleteness.complete && input.result.failureSource === 'product' && input.result.deterministic.hardFailure) return null;
  if (input.result.failureSource === 'product' && !noNextAction) return null;
  if (input.result.semantic.verdict === 'inconclusive' && hasWaitExhaustion(input.packet)) return { category: 'wait_policy_exhausted', technicalReason: '等待策略已到达上限，且没有观察到完成或明确失败证据。' };
  if (noNextAction) return { category: 'no_next_action', technicalReason: '评测器没有找到与目标相关且可安全执行的下一步。' };

  const latestObservation = input.packet.observations.at(-1);
  if (input.agentRun.status === 'abandoned' && latestObservation
    && latestObservation.interactableElements.length === 0 && latestObservation.formFields.length === 0) {
    return { category: 'insufficient_context', technicalReason: '当前页面没有提供足够的可交互上下文。' };
  }
  if (input.result.semantic.verdict === 'inconclusive' && (input.agentRun.status === 'abandoned' || input.result.failureSource === 'unknown')) {
    return { category: 'ambiguous_page_state', technicalReason: '现有页面状态支持多种解释，评测器无法可靠区分。' };
  }
  if (explicitEvaluatorFailure && input.agentRun.error) return { category: 'tool_execution_error', technicalReason: input.agentRun.error };
  if (explicitEvaluatorFailure) return { category: 'unknown', technicalReason: '评测器未能形成可信结论，现有证据不足以进一步分类。' };
  return null;
}

export function evaluatorFailureResult(result: EvalCaseResult, classification: EvaluatorFailureClassification): EvalCaseResult {
  return evalCaseResultSchema.parse({
    ...result,
    verdict: 'inconclusive',
    failureSource: 'evaluator',
    severity: null,
    semantic: {
      ...result.semantic,
      verdict: 'inconclusive',
      taskCompletion: 'unknown',
      summary: EVALUATOR_FAILURE_USER_SUMMARY,
      whatFailed: [],
      whyItMatters: ['本次结果不会被记录为产品故障，也不会进入产品回归。'],
      confirmedFacts: ['本次评测没有形成足够证据来判断产品通过或失败。'],
      hypotheses: [],
      unknowns: [...EVALUATOR_FAILURE_POSSIBLE_REASONS, `技术分类：${classification.category}；${classification.technicalReason}`],
      confidence: 0,
    },
  });
}

export function evaluatorBadcaseFrom(input: {
  evalCase: EvalCase;
  agentRun: AiTestAgentRun;
  packet: EvidencePacket;
  classification: EvaluatorFailureClassification;
}): EvaluatorBadcase {
  const evidenceRefs = [...new Set([
    ...input.packet.screenshots,
    ...(input.packet.tracePath ? [input.packet.tracePath] : []),
    ...input.packet.actions.flatMap((item) => item.evidence),
    ...input.packet.stepVerifications.flatMap((item) => item.evidenceRefs),
  ])];
  return {
    evaluatorBadcaseId: `evaluator-badcase-${input.agentRun.runId}`,
    projectId: input.evalCase.projectId,
    caseId: input.evalCase.caseId,
    runId: input.agentRun.runId,
    category: input.classification.category,
    observedState: input.packet.finalState.visibleTextSummary || input.packet.finalState.url,
    attemptedActions: input.agentRun.decisions.map((item) => `${item.action}: ${item.intentSummary}`),
    evidenceRefs,
    resolved: false,
    regressionFixtureId: null,
  };
}
