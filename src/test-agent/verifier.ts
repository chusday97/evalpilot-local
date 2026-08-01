import type { AgentActionResult, AgentDecision, PageObservation, StepVerification } from '../../types.js';
import { stepVerificationSchema } from './schemas.js';

export function verifyAgentStep(before: PageObservation, after: PageObservation, decision: AgentDecision, actionResult: AgentActionResult): StepVerification {
  if (actionResult.status === 'blocked_by_safety') return stepVerificationSchema.parse({ expectation: decision.expectedResult, observed: actionResult.summary, status: 'inconclusive', evidenceRefs: after.evidenceRefs, confidence: 1 });
  if (actionResult.status === 'failed') return stepVerificationSchema.parse({ expectation: decision.expectedResult, observed: actionResult.summary, status: 'not_confirmed', evidenceRefs: after.evidenceRefs, confidence: 0.95 });
  const routeChanged = before.pageUrl !== after.pageUrl;
  const stateChanged = before.visibleStateSummary !== after.visibleStateSummary;
  const meaningfulExpectedTokens = decision.expectedResult.toLowerCase().split(/\s+|[,，。]/).filter((item) => item.length > 2);
  const expectationVisible = meaningfulExpectedTokens.some((token) => after.visibleStateSummary.toLowerCase().includes(token));
  const status = decision.action === 'finish'
    ? 'confirmed'
    : routeChanged || stateChanged || expectationVisible
      ? 'confirmed'
      : decision.action === 'wait' || decision.action === 'scroll'
        ? 'inconclusive'
        : 'not_confirmed';
  return stepVerificationSchema.parse({
    expectation: decision.expectedResult,
    observed: routeChanged ? `页面进入 ${after.pageUrl}` : stateChanged ? '页面可见状态发生变化。' : '页面 URL 和可见状态没有变化。',
    status,
    evidenceRefs: after.evidenceRefs,
    confidence: routeChanged || stateChanged ? 0.9 : 0.65,
  });
}
