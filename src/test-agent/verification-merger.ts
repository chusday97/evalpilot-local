import type { SemanticStepVerification, StepVerification } from '../../types.js';
import { stepVerificationSchema } from './schemas.js';
import { visualEvidenceRequired } from './semantic-verifier.js';

const CONFIRMATION_THRESHOLD = 0.8;

export function mergeStepVerifications(input: {
  deterministic: StepVerification;
  semantic: SemanticStepVerification;
  hardFailure: boolean;
  expectation: string;
  visualEvidenceIncluded: boolean;
}): StepVerification {
  const evidenceRefs = [...new Set([...input.deterministic.evidenceRefs, ...input.semantic.evidenceRefs])];
  const base = {
    verificationId: input.deterministic.verificationId,
    expectation: input.expectation,
    deterministicStatus: input.deterministic.status,
    semantic: input.semantic,
    evidenceRefs,
  };
  if (input.hardFailure) return stepVerificationSchema.parse({ ...base, observed: input.deterministic.observed, status: 'not_confirmed', confidence: input.deterministic.confidence });
  if (visualEvidenceRequired(input.expectation) && !input.visualEvidenceIncluded) {
    return stepVerificationSchema.parse({ ...base, observed: '当前运行未授权截图，不能确认只靠视觉证据判断的结果。', status: 'inconclusive', confidence: 1 });
  }
  const semanticReliable = input.semantic.confidence >= CONFIRMATION_THRESHOLD;
  if (!semanticReliable || input.semantic.status === 'inconclusive') {
    return stepVerificationSchema.parse({ ...base, observed: input.deterministic.observed, status: input.deterministic.status, confidence: input.deterministic.confidence });
  }
  if (input.deterministic.status !== 'inconclusive' && input.deterministic.status !== input.semantic.status) {
    return stepVerificationSchema.parse({ ...base, observed: `确定性信号与语义验证不一致：${input.deterministic.observed}；${input.semantic.observed}`, status: 'inconclusive', confidence: Math.min(input.deterministic.confidence, input.semantic.confidence) });
  }
  const status = input.deterministic.status === 'inconclusive' ? input.semantic.status : input.deterministic.status;
  return stepVerificationSchema.parse({
    ...base,
    observed: input.deterministic.status === 'inconclusive' ? input.semantic.observed : `${input.deterministic.observed}；${input.semantic.observed}`,
    status,
    confidence: input.deterministic.status === 'inconclusive' ? input.semantic.confidence : Math.min(input.deterministic.confidence, input.semantic.confidence),
  });
}
