import type { AiProvider } from '../ai/provider.js';
import type { CoverageGap, ExplorationPlan, ProductModel } from '../../types.js';
import { explorationPlanSchema } from '../eval-set/schemas.js';
import { explorationPromptV1 } from '../prompts/exploration.v1.js';

const unsafeTerms = /delete|remove|purchase|payment|pay\b|publish|send externally|credential|password|删除|支付|购买|发布|外部发送|密码|凭证/i;

export async function planExploration(input: {
  provider: AiProvider;
  productModel: ProductModel;
  gaps: CoverageGap[];
  scope: string;
  allowRemoteModel?: boolean;
}): Promise<ExplorationPlan> {
  const prompt = explorationPromptV1.build(input);
  const plan = await input.provider.generateStructured({
    requestId: `exploration-${input.productModel.projectId}-${Date.now()}`,
    task: 'exploration',
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    schemaName: 'exploration_plan',
    imageDataUrls: [],
    privacy: {
      allowRemoteModel: input.provider.info.remote ? Boolean(input.allowRemoteModel) : true,
      allowScreenshot: false,
      visibleTextOnly: true,
      redactionApplied: true,
    },
    metadata: { projectId: input.productModel.projectId, productModelVersion: input.productModel.version },
  }, explorationPlanSchema);
  const allowedCapabilities = new Set(input.productModel.capabilities.map((item) => item.capabilityId));
  const rejected = [...plan.rejectedForSafety];
  const hypotheses = plan.hypotheses.filter((hypothesis) => {
    const unsafe = unsafeTerms.test([hypothesis.title, hypothesis.rationale, hypothesis.goal, ...hypothesis.safeActions].join(' '));
    const unknownCapability = !allowedCapabilities.has(hypothesis.capabilityId);
    if (unsafe || unknownCapability) rejected.push(`${hypothesis.hypothesisId}: ${unsafe ? '包含高风险或不可逆动作' : '能力不在 Product Model 中'}`);
    return !unsafe && !unknownCapability;
  });
  return explorationPlanSchema.parse({ ...plan, hypotheses, rejectedForSafety: rejected });
}
