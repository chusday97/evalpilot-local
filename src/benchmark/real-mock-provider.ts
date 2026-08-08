import type { AiStructuredRequest } from '../../types.js';
import { MockAiProvider } from '../ai/mock-provider.js';

type Json = Record<string, any>;

function semanticSummary(finalText: string, goal: string): string {
  const joined = `${finalText} ${goal}`;
  if (/api request failed|500/i.test(joined)) return 'API request failed and the account could not be loaded.';
  if (/duplicate request/i.test(joined)) return 'Duplicate data request occurred after one submit action.';
  if (/draft missing|reload/i.test(joined)) return 'Saved state was lost after reload.';
  if (/weather is sunny|refund policy/i.test(joined)) return 'AI output is irrelevant to the requested refund policy.';
  if (/no further action|recommendation/i.test(joined)) return 'UX result has no clear next action for the user.';
  return 'The button click produced no visible feedback and the task did not complete.';
}

function providerResponse(request: AiStructuredRequest, mode: 'normal' | 'malformed_actor'): unknown {
  const input = JSON.parse(request.userPrompt) as Json;
  if (request.task === 'actor') {
    if (mode === 'malformed_actor') return { malformed: true };
    const observation = input.observation as Json;
    const visible = String(observation.visibleStateSummary ?? '');
    const expected = (input.oracleSummary?.mustObserve ?? []) as string[];
    if (expected.length > 0 && expected.every((item) => visible.toLowerCase().includes(item.toLowerCase()))) return { intentSummary: '目标结果已经可见', action: 'finish', targetElementId: null, value: null, expectedResult: expected.join('；'), confidence: 1 };
    const emptyField = (observation.formFields ?? []).find((field: Json) => !field.currentValuePresent && !field.disabled);
    if (emptyField) return { intentSummary: '填写完成任务所需信息', action: 'fill', targetElementId: emptyField.elementId, value: null, expectedResult: '输入值出现在表单中', confidence: 1 };
    const recentTargets = new Set((input.recentDecisions ?? []).map((item: Json) => item.targetElementId).filter(Boolean));
    const elements = (observation.interactableElements ?? []) as Json[];
    const unused = elements.find((element) => !element.disabled && !recentTargets.has(element.elementId));
    const target = unused ?? elements.find((element) => !element.disabled);
    if (target) return { intentSummary: `使用可见操作：${target.label ?? target.text ?? '继续'}`, action: 'click', targetElementId: target.elementId, value: null, expectedResult: expected[0] ?? '页面出现明确结果或下一步', confidence: 1 };
    return { intentSummary: '没有可继续完成任务的安全操作', action: 'abandon', targetElementId: null, value: null, expectedResult: '停止并保留证据', confidence: 1 };
  }
  if (request.task === 'semantic_verifier') {
    const before = String(input.before?.summary ?? ''); const after = String(input.after?.summary ?? '');
    const changed = before !== after || (input.networkDelta ?? []).length > 0 || (input.consoleDelta ?? []).length > 0;
    const refs = [...new Set([...(input.after?.evidenceRefs ?? []), ...(input.action?.result?.evidenceRefs ?? [])])];
    return { status: changed || input.action?.action === 'finish' ? 'confirmed' : 'not_confirmed', observed: changed ? '动作后出现可核对的页面或网络变化。' : '动作前后没有可核对的稳定变化。', confirmedFacts: changed ? ['动作前后证据存在稳定差异'] : ['动作前后页面状态未变化'], unknowns: [], evidenceRefs: refs, confidence: 0.95 };
  }
  if (request.task === 'semantic_judge') {
    const deterministic = input.deterministic as Json; const finalText = String(input.finalState?.visibleTextSummary ?? ''); const goal = String(input.case?.goal ?? '');
    if (deterministic.hardFailure) {
      const refs = [...new Set([...(deterministic.evidenceRefs ?? []), ...((input.observations ?? []).flatMap((item: Json) => item.evidenceRefs ?? []))])];
      const summary = semanticSummary(finalText, goal);
      return { verdict: 'fail', taskCompletion: 'failed', summary, whatWorked: ['页面和动作证据已保存'], whatFailed: [summary], whyItMatters: ['用户无法完成目标任务'], confirmedFacts: [summary], hypotheses: [], unknowns: [], evidenceRefs: refs, confidence: 0.95 };
    }
    const allPass = (deterministic.checks ?? []).length > 0 && deterministic.checks.every((check: Json) => check.verdict === 'pass');
    return allPass
      ? { verdict: 'pass', taskCompletion: 'complete', summary: 'The expected user-visible result is present.', whatWorked: ['Expected result is visible'], whatFailed: [], whyItMatters: [], confirmedFacts: ['Expected result is visible'], hypotheses: [], unknowns: [], evidenceRefs: deterministic.evidenceRefs ?? [], confidence: 0.95 }
      : { verdict: 'inconclusive', taskCompletion: 'unknown', summary: 'The available evidence cannot establish task completion.', whatWorked: [], whatFailed: [], whyItMatters: [], confirmedFacts: [], hypotheses: [], unknowns: ['No supported deterministic completion signal'], evidenceRefs: [], confidence: 0.4 };
  }
  return {};
}

export function createRealBenchmarkProvider(mode: 'normal' | 'malformed_actor' = 'normal'): MockAiProvider {
  return new MockAiProvider((request) => providerResponse(request, mode), mode === 'malformed_actor' ? 0 : 1);
}
