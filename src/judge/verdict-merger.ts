import type { DeterministicJudgeResult, EvalCase, EvalCaseResult, EvidencePacket, SemanticJudgeResult } from '../../types.js';
import { evalCaseResultSchema } from './schemas.js';
import { calculateEvidenceCompleteness } from '../test-agent/evidence-packet.js';

export function evidencePacketComplete(packet: EvidencePacket): boolean {
  return calculateEvidenceCompleteness(packet).complete;
}

export function mergeJudgeVerdicts(input: {
  evalCase: EvalCase;
  packet: EvidencePacket;
  deterministic: DeterministicJudgeResult;
  semantic: SemanticJudgeResult;
  semanticEvaluatorFailed: boolean;
  createdAt?: string;
}): EvalCaseResult {
  const completeness = calculateEvidenceCompleteness(input.packet);
  const complete = completeness.complete;
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
  const semantic = complete ? input.semantic : {
    ...input.semantic,
    verdict: 'inconclusive' as const,
    taskCompletion: 'unknown' as const,
    summary: `评测证据不完整，当前不能判断产品通过或失败：${completeness.missing.join(' ')}`,
    confirmedFacts: [],
    hypotheses: [],
    unknowns: [...new Set([...input.semantic.unknowns, ...completeness.missing])],
    confidence: 0,
  };
  return evalCaseResultSchema.parse({
    runId: input.packet.runId,
    caseId: input.evalCase.caseId,
    verdict,
    failureSource,
    severity,
    deterministic: input.deterministic,
    semantic,
    evidencePacketPath: `runs/${input.packet.runId}/evidence-packet.json`,
    createdAt: input.createdAt ?? new Date().toISOString(),
  });
}
