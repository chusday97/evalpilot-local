import { resolve } from 'node:path';
import type { AgentDecision, EvidenceCompleteness, EvidencePacket, PageObservation, StepVerification } from '../../types.js';
import { writeJsonAtomic, writeJsonLinesAtomic } from '../utils/file-system.js';
import { currentEvidencePacketSchema } from './schemas.js';

export function calculateEvidenceCompleteness(packet: Omit<EvidencePacket, 'evidenceCompleteness'> | EvidencePacket): EvidenceCompleteness {
  const observationById = new Map(packet.observations.map((item) => [item.observationId, item]));
  const verificationById = new Map(packet.stepVerifications.map((item) => [item.verificationId, item]));
  const screenshots = new Set(packet.screenshots);
  const hasInitialObservation = packet.observations.length > 0 && (packet.stepEvidence.length === 0 || observationById.has(packet.stepEvidence[0]!.beforeObservationId));
  const finalStep = packet.stepEvidence.at(-1);
  const hasFinalObservation = packet.finalState.url.length > 0
    && packet.finalState.visibleTextSummary.length > 0
    && Boolean(finalStep && observationById.has(finalStep.afterObservationId));
  const hasBeforeAfterScreenshots = packet.stepEvidence.length > 0
    && packet.stepEvidence.length === packet.actions.length
    && packet.stepEvidence.every((step) => {
      const before = observationById.get(step.beforeObservationId);
      const after = observationById.get(step.afterObservationId);
      return step.beforeScreenshotPath !== step.afterScreenshotPath
        && screenshots.has(step.beforeScreenshotPath)
        && screenshots.has(step.afterScreenshotPath)
        && Boolean(before?.evidenceRefs.includes(step.beforeScreenshotPath))
        && Boolean(after?.evidenceRefs.includes(step.afterScreenshotPath));
    });
  const hasStepVerifications = packet.stepEvidence.length > 0
    && packet.stepEvidence.length === packet.actions.length
    && packet.stepEvidence.every((step) => {
      const verification = verificationById.get(step.verificationId);
      return Boolean(verification?.evidenceRefs.includes(step.afterScreenshotPath));
    });
  const hasTrace = Boolean(packet.tracePath);
  const missing = [
    !hasInitialObservation ? '缺少初始页面观察。' : null,
    !hasFinalObservation ? '缺少与最终动作关联的页面观察或最终状态。' : null,
    !hasBeforeAfterScreenshots ? '至少一个动作缺少独立的前后截图或截图引用。' : null,
    !hasStepVerifications ? '至少一个执行动作缺少对应的验证记录。' : null,
    !hasTrace ? '缺少本地 Playwright Trace。' : null,
  ].filter((item): item is string => item !== null);
  return { complete: missing.length === 0, hasInitialObservation, hasFinalObservation, hasBeforeAfterScreenshots, hasStepVerifications, hasTrace, missing };
}

export async function saveAgentEvidence(outputDir: string, packet: EvidencePacket, decisions: AgentDecision[]): Promise<string> {
  const evidenceCompleteness = calculateEvidenceCompleteness(packet);
  const validatedPacket = currentEvidencePacketSchema.parse({ ...packet, evidenceCompleteness });
  const runDirectory = resolve(outputDir, 'runs', packet.runId);
  await Promise.all([
    writeJsonAtomic(resolve(runDirectory, 'evidence-packet.json'), validatedPacket),
    writeJsonLinesAtomic(resolve(runDirectory, 'observations.jsonl'), validatedPacket.observations),
    writeJsonLinesAtomic(resolve(runDirectory, 'agent-decisions.jsonl'), decisions.map((decision, index) => ({ ...decision, decisionId: decision.decisionId ?? `decision-${String(index + 1).padStart(3, '0')}` }))),
    writeJsonLinesAtomic(resolve(runDirectory, 'verifications.jsonl'), validatedPacket.stepVerifications),
  ]);
  return resolve(runDirectory, 'evidence-packet.json');
}

export function observationSummary(observation: PageObservation): string {
  return observation.visibleStateSummary.slice(0, 1_000);
}

export function verificationEvidence(verifications: StepVerification[]): string[] {
  return [...new Set(verifications.flatMap((item) => item.evidenceRefs))];
}
