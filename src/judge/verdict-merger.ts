import type { DeterministicJudgeResult, EvalCase, EvalCaseResult, EvidencePacket, SemanticJudgeResult } from '../../types.js';
import { evalCaseResultSchema } from './schemas.js';

export function evidencePacketComplete(packet: EvidencePacket): boolean {
  return packet.observations.length > 0
    && packet.stepVerifications.length > 0
    && packet.finalState.url.length > 0
    && packet.finalState.visibleTextSummary.length > 0;
}

export function mergeJudgeVerdicts(input: {
  evalCase: EvalCase;
  packet: EvidencePacket;
  deterministic: DeterministicJudgeResult;
  semantic: SemanticJudgeResult;
  semanticEvaluatorFailed: boolean;
  createdAt?: string;
}): EvalCaseResult {
  const complete = evidencePacketComplete(input.packet);
  let verdict: EvalCaseResult['verdict'] = 'inconclusive';
  let failureSource: EvalCaseResult['failureSource'] = null;
  let severity: EvalCaseResult['severity'] = null;
  if (!complete || input.semanticEvaluatorFailed) {
    failureSource = 'evaluator';
  } else if (input.deterministic.hardFailure || input.semantic.verdict === 'fail') {
    verdict = 'fail'; failureSource = 'product'; severity = input.deterministic.severity ?? input.evalCase.riskLevel;
  } else if (input.deterministic.checks.some((item) => item.verdict === 'inconclusive') || input.semantic.verdict === 'inconclusive') {
    failureSource = 'unknown';
  } else if (input.deterministic.checks.every((item) => item.verdict === 'pass') && input.semantic.verdict === 'pass') {
    verdict = 'pass';
  }
  return evalCaseResultSchema.parse({
    runId: input.packet.runId,
    caseId: input.evalCase.caseId,
    verdict,
    failureSource,
    severity,
    deterministic: input.deterministic,
    semantic: input.semantic,
    evidencePacketPath: `runs/${input.packet.runId}/evidence-packet.json`,
    createdAt: input.createdAt ?? new Date().toISOString(),
  });
}
