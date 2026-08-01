import { resolve } from 'node:path';
import type { AgentDecision, EvidencePacket, PageObservation, StepVerification } from '../../types.js';
import { writeJsonAtomic, writeJsonLinesAtomic } from '../utils/file-system.js';
import { evidencePacketSchema } from './schemas.js';

export async function saveAgentEvidence(outputDir: string, packet: EvidencePacket, decisions: AgentDecision[]): Promise<string> {
  const validatedPacket = evidencePacketSchema.parse(packet);
  const runDirectory = resolve(outputDir, 'runs', packet.runId);
  await Promise.all([
    writeJsonAtomic(resolve(runDirectory, 'evidence-packet.json'), validatedPacket),
    writeJsonLinesAtomic(resolve(runDirectory, 'observations.jsonl'), validatedPacket.observations),
    writeJsonLinesAtomic(resolve(runDirectory, 'agent-decisions.jsonl'), decisions),
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
