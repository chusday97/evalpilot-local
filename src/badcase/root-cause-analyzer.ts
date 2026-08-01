import type { EvalCaseResult, RootCauseHypothesis } from '../../types.js';

export function rootCauseHypothesesFromResult(result: EvalCaseResult): RootCauseHypothesis[] {
  return result.semantic.hypotheses.map((item) => ({
    hypothesis: item.hypothesis,
    confidence: item.confidence,
    supportingEvidence: [...item.supportingEvidence],
    contradictingEvidence: [...item.contradictingEvidence],
    howToVerify: [...item.howToVerify],
  }));
}
