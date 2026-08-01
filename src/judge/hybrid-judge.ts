import { resolve } from 'node:path';
import type { AiProvider } from '../ai/provider.js';
import type { EvalCase, EvalCaseResult, EvidencePacket } from '../../types.js';
import { writeSchemaJsonAtomic } from '../utils/schema-file.js';
import { runDeterministicJudge } from './deterministic-judge.js';
import { saveEvalCaseResult } from './eval-result-store.js';
import { deterministicJudgeResultSchema, semanticJudgeResultSchema } from './schemas.js';
import { runSemanticJudge } from './semantic-judge.js';
import { mergeJudgeVerdicts } from './verdict-merger.js';

export async function judgeEvalCase(input: {
  outputDir: string;
  evalCase: EvalCase;
  packet: EvidencePacket;
  provider: AiProvider;
  allowRemoteModel?: boolean;
  createdAt?: string;
}): Promise<EvalCaseResult> {
  const deterministic = runDeterministicJudge(input.evalCase, input.packet);
  const semanticOutcome = await runSemanticJudge({ provider: input.provider, evalCase: input.evalCase, packet: input.packet, deterministic, allowRemoteModel: Boolean(input.allowRemoteModel) });
  const runDirectory = resolve(input.outputDir, 'runs', input.packet.runId);
  await Promise.all([
    writeSchemaJsonAtomic(resolve(runDirectory, 'deterministic-judge.json'), deterministic, deterministicJudgeResultSchema),
    writeSchemaJsonAtomic(resolve(runDirectory, 'semantic-judge.json'), semanticOutcome.result, semanticJudgeResultSchema),
  ]);
  return saveEvalCaseResult(input.outputDir, mergeJudgeVerdicts({ evalCase: input.evalCase, packet: input.packet, deterministic, semantic: semanticOutcome.result, semanticEvaluatorFailed: semanticOutcome.evaluatorFailed, createdAt: input.createdAt }));
}
