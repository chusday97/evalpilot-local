import type { DeterministicCheckResult, DeterministicJudgeResult, EvalCase, EvidencePacket } from '../../types.js';
import { deterministicJudgeResultSchema } from './schemas.js';

function canonicalFinalObservation(packet: EvidencePacket) {
  const finalStep = packet.stepEvidence.at(-1);
  if (!finalStep) return null;
  return packet.observations.find((item) => item.observationId === finalStep.afterObservationId) ?? null;
}

function checkAssertion(evalCase: EvalCase, packet: EvidencePacket, index: number): DeterministicCheckResult {
  const assertion = evalCase.oracle.deterministicAssertions[index]!;
  const finalObservation = canonicalFinalObservation(packet);
  const text = finalObservation?.visibleStateSummary ?? packet.finalState.visibleTextSummary;
  const finalUrl = finalObservation?.pageUrl ?? packet.finalState.url;
  const network = packet.networkEvidence.join('\n');
  const consoleText = packet.consoleEvidence.join('\n');
  let verdict: DeterministicCheckResult['verdict'] = 'inconclusive';
  let summary = '现有证据不足以判断该断言。';
  if (assertion.type === 'url_matches') {
    const matched = finalUrl.includes(assertion.target);
    verdict = matched !== assertion.negated ? 'pass' : 'fail'; summary = `最终 URL ${matched ? '匹配' : '不匹配'} ${assertion.target}。`;
  } else if (assertion.type === 'text_visible' || assertion.type === 'text_absent') {
    const present = text.toLowerCase().includes(assertion.target.toLowerCase());
    const expectedPresent = assertion.type === 'text_visible' ? !assertion.negated : assertion.negated;
    verdict = present === expectedPresent ? 'pass' : 'fail'; summary = `最终页面${present ? '包含' : '不包含'}“${assertion.target}”。`;
  } else if (assertion.type === 'request_observed') {
    const present = network.includes(assertion.target);
    verdict = present !== assertion.negated ? 'pass' : 'fail'; summary = `网络证据${present ? '包含' : '不包含'} ${assertion.target}。`;
  } else if (assertion.type === 'console_error_absent') {
    const present = consoleText.toLowerCase().includes(assertion.target.toLowerCase());
    verdict = present === assertion.negated ? 'pass' : 'fail'; summary = `控制台${present ? '发现' : '未发现'}目标错误。`;
  } else if (assertion.type === 'state_persisted') {
    summary = 'Evidence Packet 没有跨刷新/重开状态证据，无法判断持久化。';
  }
  return { assertionId: assertion.assertionId, verdict, summary, evidenceRefs: [...new Set(packet.observations.flatMap((item) => item.evidenceRefs))] };
}

export function runDeterministicJudge(evalCase: EvalCase, packet: EvidencePacket): DeterministicJudgeResult {
  const checks = evalCase.oracle.deterministicAssertions.map((_assertion, index) => checkAssertion(evalCase, packet, index));
  return deterministicJudgeResultSchema.parse({
    checks,
    hardFailure: checks.some((item) => item.verdict === 'fail'),
    severity: checks.some((item) => item.verdict === 'fail') ? evalCase.riskLevel : null,
    evidenceRefs: [...new Set(checks.flatMap((item) => item.evidenceRefs))],
  });
}
