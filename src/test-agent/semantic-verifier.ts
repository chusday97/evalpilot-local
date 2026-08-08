import type { AiProvider } from '../ai/provider.js';
import type { AgentActionResult, AgentDecision, PageObservation, SemanticStepVerification } from '../../types.js';
import { verifierPromptV1 } from '../prompts/verifier.v1.js';
import { semanticStepVerificationSchema } from './schemas.js';

export function visualEvidenceRequired(expectation: string): boolean {
  return /\b(color|layout|spacing|alignment|image|icon|animation|visual|appearance|position|size)\b|颜色|布局|间距|对齐|图片|图标|动画|视觉|外观|位置|尺寸/i.test(expectation);
}

export async function runSemanticStepVerifier(input: {
  provider: AiProvider;
  decision: AgentDecision;
  before: PageObservation;
  after: PageObservation;
  actionResult: AgentActionResult;
  networkDelta: string[];
  consoleDelta: string[];
  beforeScreenshotDataUrl: string | null;
  afterScreenshotDataUrl: string | null;
  allowRemoteModel: boolean;
  allowScreenshot: boolean;
}): Promise<SemanticStepVerification> {
  const visualEvidenceIncluded = Boolean(input.beforeScreenshotDataUrl && input.afterScreenshotDataUrl && input.allowScreenshot);
  const prompt = verifierPromptV1.build({ ...input, visualEvidenceIncluded });
  try {
    const result = await input.provider.generateStructured({
      requestId: `semantic-verifier-${input.decision.decisionId ?? 'standalone'}`,
      task: 'semantic_verifier',
      systemPrompt: prompt.system,
      userPrompt: prompt.user,
      schemaName: 'semantic_step_verification',
      imageDataUrls: visualEvidenceIncluded ? [input.beforeScreenshotDataUrl!, input.afterScreenshotDataUrl!] : [],
      privacy: {
        allowRemoteModel: input.provider.info.remote ? input.allowRemoteModel : true,
        allowScreenshot: visualEvidenceIncluded,
        visibleTextOnly: !visualEvidenceIncluded,
        redactionApplied: true,
      },
      metadata: { promptVersion: verifierPromptV1.version },
    }, semanticStepVerificationSchema);
    const allowedEvidenceRefs = new Set([
      ...input.before.evidenceRefs,
      ...input.after.evidenceRefs,
      ...input.actionResult.evidenceRefs,
    ]);
    return semanticStepVerificationSchema.parse({
      ...result,
      evidenceRefs: result.evidenceRefs.filter((reference) => allowedEvidenceRefs.has(reference)),
    });
  } catch (error) {
    return semanticStepVerificationSchema.parse({
      status: 'inconclusive',
      observed: '语义步骤验证器未能产生可信结论。',
      confirmedFacts: [],
      unknowns: [error instanceof Error ? error.message : String(error)],
      evidenceRefs: [],
      confidence: 0,
    });
  }
}
