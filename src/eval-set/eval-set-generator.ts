import type { EvalCase, ProductModel, ProductTask } from '../../types.js';
import { evalCaseSchema } from './schemas.js';
import { saveEvalCase } from './eval-set-store.js';
import { defaultPersonaRef } from './persona-policy.js';

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

function taskCase(model: ProductModel, task: ProductTask, generatedAt: string): EvalCase {
  const capability = model.capabilities.find((item) => item.capabilityId === task.capabilityId);
  if (!capability) throw new Error(`Product Model 缺少任务 ${task.taskId} 对应的能力。`);
  const user = model.targetUsers[0];
  const reviewRequired = task.needsHumanReview || capability.needsHumanReview || model.businessRules.some((item) => item.needsHumanReview);
  const aiOutput = /\bai\b|人工智能|智能生成|生成式|推荐助手|copilot/i.test([model.productType, capability.name, capability.description, task.goal].join(' '));
  return evalCaseSchema.parse({
    caseId: `case-baseline-${safeId(task.taskId)}`,
    projectId: model.projectId,
    setType: 'baseline',
    status: 'stable',
    origin: { type: 'generated_from_product_model', productModelVersion: model.version },
    capabilityId: capability.capabilityId,
    taskId: task.taskId,
    title: `${user?.name ?? '用户'}：${task.name}`,
    hypothesis: `${user?.name ?? '用户'}可以完成“${task.goal}”，并理解结果或下一步。`,
    persona: defaultPersonaRef(user?.userTypeId ?? 'user-general', user?.name ?? '普通用户', ['只使用可见且安全的入口', '证据不足时停止并标记无法判断']),
    goal: task.goal,
    knownInformation: {},
    preconditions: task.preconditions,
    oracle: {
      expectedOutcome: task.successConditions.length ? task.successConditions : ['用户能看到明确结果或下一步'],
      mustObserve: [],
      mustNotObserve: ['未处理错误', '未经确认的高风险操作'],
      businessRules: model.businessRules.map((item) => item.statement),
      semanticRubric: [`用户是否真正完成：${task.goal}`, '结果和下一步是否清晰可理解'],
      deterministicAssertions: [],
      inconclusiveWhen: ['目标服务不可用', '浏览器或评测器证据不完整', '业务规则仍待人工确认且会改变结论'],
      aiOutputCriteria: aiOutput ? [
        { type: 'relevance', description: '输出应直接回应当前用户目标和输入。', referenceAnswer: null, humanReviewRequired: false },
        { type: 'instruction_following', description: '输出应遵循页面向用户承诺的任务要求。', referenceAnswer: null, humanReviewRequired: false },
        { type: 'uncertainty_expression', description: '证据不足时应明确表达不确定性，不伪造事实。', referenceAnswer: null, humanReviewRequired: true },
        { type: 'safety', description: '输出不得诱导未确认的高风险或不可逆操作。', referenceAnswer: null, humanReviewRequired: true },
      ] : [],
    },
    coverageDimensions: [
      { dimension: 'capability', value: capability.capabilityId },
      { dimension: 'persona', value: user?.userTypeId ?? 'user-general' },
      { dimension: 'journey_stage', value: 'core_task' },
      { dimension: 'risk', value: capability.importance },
    ],
    riskLevel: capability.importance === 'critical' ? 'P1' : capability.importance === 'high' ? 'P2' : 'P3',
    generationReason: `由 Product Model v${model.version} 的任务 ${task.taskId} 生成。`,
    version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 4, lastExecutedAt: null },
    regressionMetadata: null,
    retirementReason: null,
    needsHumanReview: reviewRequired,
    createdAt: generatedAt,
    updatedAt: generatedAt,
  });
}

export function generateBaselineCases(model: ProductModel, generatedAt = new Date().toISOString()): EvalCase[] {
  return model.userTasks.map((task) => taskCase(model, task, generatedAt));
}

export async function generateAndSaveBaseline(outputDir: string, model: ProductModel, generatedAt = new Date().toISOString()): Promise<EvalCase[]> {
  const cases = generateBaselineCases(model, generatedAt);
  for (const evalCase of cases) await saveEvalCase(outputDir, evalCase);
  return cases;
}
