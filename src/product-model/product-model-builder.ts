import type { BusinessRule, EvalBlueprint, EvidenceClaim, FactStatus, ProductCapability, ProductModel, ProductTask, ProjectBackground } from '../../types.js';
import { productModelSchema } from './schemas.js';

function slug(value: string): string {
  const result = value.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return result || 'item';
}

function evidenceFor(background: ProjectBackground, field: string): EvidenceClaim[] {
  return background.fieldEvidence[field] ?? background.evidence.slice(0, 1);
}

function statusFor(background: ProjectBackground, field: string): FactStatus {
  return background.fieldStatuses[field] ?? 'unknown';
}

export function buildProductModel(input: { projectId: string; background: ProjectBackground; blueprint: EvalBlueprint; version?: number; generatedAt?: string }): ProductModel {
  const blueprintById = new Map(input.blueprint.capabilities.map((item) => [item.id, item]));
  const userTasks: ProductTask[] = [];
  const capabilities: ProductCapability[] = input.background.capabilities.map((capability) => {
    const blueprint = blueprintById.get(capability.id);
    const goals = blueprint?.userGoals.length ? blueprint.userGoals : [`完成${capability.name}的主要任务`];
    const taskIds = goals.map((goal, index) => {
      const taskId = `task-${slug(capability.id.replace(/^cap-/, ''))}-${index + 1}`;
      userTasks.push({
        taskId,
        capabilityId: capability.id,
        name: goals.length === 1 ? capability.name : `${capability.name}：${goal}`,
        goal,
        preconditions: blueprint?.dependencies ?? capability.dependencies,
        successConditions: blueprint?.successConditions.length ? blueprint.successConditions : ['用户能看到明确结果或下一步'],
        evidenceStatus: blueprint ? capability.status : 'inferred',
        evidence: capability.evidence,
        needsHumanReview: !blueprint || blueprint.approvalStatus === 'needs_human_review' || capability.status === 'inferred' || capability.status === 'unknown',
      });
      return taskId;
    });
    return {
      capabilityId: capability.id,
      name: capability.name,
      description: capability.description,
      routes: capability.routes,
      entryPoints: blueprint?.entryPoints ?? capability.routes,
      userGoals: goals,
      supportedTasks: taskIds,
      importance: blueprint?.importance ?? 'medium',
      evidenceStatus: capability.status,
      evidence: capability.evidence,
      needsHumanReview: !blueprint || blueprint.approvalStatus === 'needs_human_review' || capability.status === 'inferred' || capability.status === 'unknown',
    };
  });
  const businessRules = [...new Map(input.blueprint.capabilities.flatMap((capability) => capability.hardConstraints.map((statement) => [statement, { capability, statement }] as const))).values()]
    .map(({ capability, statement }, index): BusinessRule => ({
      ruleId: `rule-${index + 1}`,
      statement,
      evidenceStatus: capability.approvalStatus === 'approved' ? 'declared' : 'unknown',
      evidence: evidenceFor(input.background, 'ruleResponsibilities'),
      needsHumanReview: capability.approvalStatus !== 'approved',
    }));
  const knownRisks = input.background.capabilities.flatMap((capability) => capability.risks.map((risk, index) => ({
    riskId: `risk-${slug(capability.id)}-${index + 1}`,
    title: risk,
    description: `${capability.name}：${risk}`,
    severity: 'P2' as const,
    evidenceStatus: capability.status,
    evidence: capability.evidence,
    needsHumanReview: capability.status !== 'verified',
  })));
  return productModelSchema.parse({
    projectId: input.projectId,
    version: input.version ?? 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    productName: input.background.projectName,
    productType: input.background.projectType,
    targetUsers: input.background.targetUsers.map((name, index) => ({
      userTypeId: `user-${slug(name)}-${index + 1}`,
      name,
      description: `${name} 是当前产品背景中声明或推断的目标用户。`,
      goals: input.background.userTasks,
      evidenceStatus: statusFor(input.background, 'targetUsers'),
      evidence: evidenceFor(input.background, 'targetUsers'),
      needsHumanReview: statusFor(input.background, 'targetUsers') === 'unknown' || statusFor(input.background, 'targetUsers') === 'inferred',
    })),
    capabilities,
    userTasks,
    businessRules,
    knownRisks,
    unknowns: input.background.unknowns.map((question, index) => ({ unknownId: `unknown-${index + 1}`, question, impact: '可能影响案例前置条件、Oracle 或上线判断。', resolutionHint: '由产品负责人确认，或补充直接运行/文档证据。' })),
    evidence: input.background.evidence,
  });
}
