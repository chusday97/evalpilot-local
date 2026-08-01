import type { AiProvider } from '../ai/provider.js';
import type { DeterministicJudgeResult, EvalCase, EvidencePacket, SemanticJudgeResult } from '../../types.js';
import { semanticJudgePromptV1 } from '../prompts/semantic-judge.v1.js';
import { semanticJudgeResultSchema } from './schemas.js';

export interface SemanticJudgeOutcome {
  result: SemanticJudgeResult;
  evaluatorFailed: boolean;
  error: string | null;
}

export async function runSemanticJudge(input: {
  provider: AiProvider;
  evalCase: EvalCase;
  packet: EvidencePacket;
  deterministic: DeterministicJudgeResult;
  allowRemoteModel: boolean;
}): Promise<SemanticJudgeOutcome> {
  const prompt = semanticJudgePromptV1.build(input);
  try {
    const result = await input.provider.generateStructured({
      requestId: `semantic-${input.packet.runId}`,
      task: 'semantic_judge',
      systemPrompt: prompt.system,
      userPrompt: prompt.user,
      schemaName: 'semantic_judge_result',
      imageDataUrls: [],
      privacy: { allowRemoteModel: input.provider.info.remote ? input.allowRemoteModel : true, allowScreenshot: false, visibleTextOnly: true, redactionApplied: true },
      metadata: { caseId: input.evalCase.caseId, runId: input.packet.runId, promptVersion: semanticJudgePromptV1.version },
    }, semanticJudgeResultSchema);
    return { result, evaluatorFailed: false, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      result: semanticJudgeResultSchema.parse({ verdict: 'inconclusive', taskCompletion: 'unknown', summary: '语义评测器未能产生可信结论。', whatWorked: [], whatFailed: [], whyItMatters: [], confirmedFacts: [], hypotheses: [], unknowns: [message], evidenceRefs: [], confidence: 0 }),
      evaluatorFailed: true,
      error: message,
    };
  }
}
