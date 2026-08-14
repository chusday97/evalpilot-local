import type { DeterministicCheckResult, DeterministicJudgeResult, EvalCase, EvidencePacket, PageObservation } from '../../types.js';
import { deterministicJudgeResultSchema } from './schemas.js';

interface DeterministicEvidenceSnapshot {
  text: string;
  url: string;
  network: string;
  consoleText: string;
  evidenceRefs: string[];
}

function canonicalFinalObservation(packet: EvidencePacket) {
  const finalStep = packet.stepEvidence.at(-1);
  if (!finalStep) return null;
  return packet.observations.find((item) => item.observationId === finalStep.afterObservationId) ?? null;
}

function checkAssertion(evalCase: EvalCase, snapshot: DeterministicEvidenceSnapshot, index: number): DeterministicCheckResult {
  const assertion = evalCase.oracle.deterministicAssertions[index]!;
  let verdict: DeterministicCheckResult['verdict'] = 'inconclusive';
  let summary = '现有证据不足以判断该断言。';
  if (assertion.type === 'url_matches') {
    const matched = snapshot.url.includes(assertion.target);
    verdict = matched !== assertion.negated ? 'pass' : 'fail'; summary = `最终 URL ${matched ? '匹配' : '不匹配'} ${assertion.target}。`;
  } else if (assertion.type === 'text_visible' || assertion.type === 'text_absent') {
    const present = snapshot.text.toLowerCase().includes(assertion.target.toLowerCase());
    const expectedPresent = assertion.type === 'text_visible' ? !assertion.negated : assertion.negated;
    verdict = present === expectedPresent ? 'pass' : 'fail'; summary = `最终页面${present ? '包含' : '不包含'}“${assertion.target}”。`;
  } else if (assertion.type === 'request_observed') {
    const present = snapshot.network.includes(assertion.target);
    verdict = present !== assertion.negated ? 'pass' : 'fail'; summary = `网络证据${present ? '包含' : '不包含'} ${assertion.target}。`;
  } else if (assertion.type === 'console_error_absent') {
    const present = snapshot.consoleText.toLowerCase().includes(assertion.target.toLowerCase());
    verdict = present === assertion.negated ? 'pass' : 'fail'; summary = `控制台${present ? '发现' : '未发现'}目标错误。`;
  } else if (assertion.type === 'state_persisted') {
    summary = 'Evidence Packet 没有跨刷新/重开状态证据，无法判断持久化。';
  }
  return { assertionId: assertion.assertionId, verdict, summary, evidenceRefs: snapshot.evidenceRefs };
}

export function evaluateDeterministicAssertionsAtObservation(input: {
  evalCase: EvalCase;
  observation: PageObservation;
  networkEvidence?: string[];
  consoleEvidence?: string[];
}): DeterministicCheckResult[] {
  const snapshot: DeterministicEvidenceSnapshot = {
    text: input.observation.visibleStateSummary,
    url: input.observation.pageUrl,
    network: (input.networkEvidence ?? []).join('\n'),
    consoleText: (input.consoleEvidence ?? []).join('\n'),
    evidenceRefs: [...new Set(input.observation.evidenceRefs)],
  };
  return input.evalCase.oracle.deterministicAssertions.map((_assertion, index) => checkAssertion(input.evalCase, snapshot, index));
}

export function deterministicOracleSatisfiedAtObservation(input: {
  evalCase: EvalCase;
  observation: PageObservation;
  networkEvidence?: string[];
  consoleEvidence?: string[];
}): boolean {
  const assertions = input.evalCase.oracle.deterministicAssertions;
  if (assertions.length === 0 || assertions.some((assertion) => assertion.type === 'state_persisted')) return false;
  const hasPositiveCompletionSignal = assertions.some((assertion) => (
    (assertion.type === 'text_visible' || assertion.type === 'url_matches' || assertion.type === 'request_observed')
    && !assertion.negated
  ));
  if (!hasPositiveCompletionSignal) return false;
  const checks = evaluateDeterministicAssertionsAtObservation(input);
  return checks.length === assertions.length && checks.every((check) => check.verdict === 'pass');
}

export function runDeterministicJudge(evalCase: EvalCase, packet: EvidencePacket): DeterministicJudgeResult {
  const finalObservation = canonicalFinalObservation(packet);
  const snapshot: DeterministicEvidenceSnapshot = {
    text: finalObservation?.visibleStateSummary ?? packet.finalState.visibleTextSummary,
    url: finalObservation?.pageUrl ?? packet.finalState.url,
    network: packet.networkEvidence.join('\n'),
    consoleText: packet.consoleEvidence.join('\n'),
    evidenceRefs: [...new Set(packet.observations.flatMap((item) => item.evidenceRefs))],
  };
  const checks = evalCase.oracle.deterministicAssertions.map((_assertion, index) => checkAssertion(evalCase, snapshot, index));
  return deterministicJudgeResultSchema.parse({
    checks,
    hardFailure: checks.some((item) => item.verdict === 'fail'),
    severity: checks.some((item) => item.verdict === 'fail') ? evalCase.riskLevel : null,
    evidenceRefs: [...new Set(checks.flatMap((item) => item.evidenceRefs))],
  });
}
