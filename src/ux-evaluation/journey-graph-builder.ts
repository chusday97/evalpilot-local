import type { BlueprintCapability, EvalBlueprint, EvidenceClaim, FeatureJourneyGraph, JourneyStepDefinition, JourneyStepType } from '../../types.js';
import { featureJourneyGraphSchema } from '../schemas/ux-evaluation.js';

function evidence(capability: BlueprintCapability, claim: string): EvidenceClaim[] {
  return [{ claim, sourceType: 'document', source: `eval-blueprint.yaml#${capability.id}`, status: 'declared' }];
}

function step(
  capability: BlueprintCapability,
  suffix: string,
  label: string,
  type: JourneyStepType,
): JourneyStepDefinition {
  return {
    stepId: `${capability.id}-${suffix}`,
    label,
    type,
    evidence: evidence(capability, `${capability.name}：${label}`),
    approvalStatus: capability.approvalStatus,
  };
}

function followUpConditions(capability: BlueprintCapability): string[] {
  const explicit = capability.successConditions.filter((condition) => /保存|修改|导出|分享|继续|结束/.test(condition));
  return explicit.length ? explicit : ['用户可以保存、修改、继续或明确结束任务'];
}

export function buildFeatureJourneyGraph(capability: BlueprintCapability): FeatureJourneyGraph {
  const steps: JourneyStepDefinition[] = [
    step(capability, 'discover-entry', `从 ${capability.entryPoints.join(' / ')} 发现功能入口`, 'required'),
    step(capability, 'understand-purpose', `理解“${capability.name}”的用途`, 'explanation'),
    step(capability, 'provide-input', '提供完成目标所需的必要信息', 'required'),
    step(capability, 'execute', '执行核心操作', 'required'),
    ...capability.hardConstraints.map((constraint, index) => step(capability, `safety-${index + 1}`, constraint, 'safety')),
    step(capability, 'receive-feedback', '获得明确的处理中、成功或失败反馈', 'required'),
    step(capability, 'understand-result', '找到并理解结果及其依据', 'explanation'),
    step(capability, 'follow-up', followUpConditions(capability).join('；'), 'required'),
  ];
  const primaryPath = steps.map((item) => item.stepId);
  const recovery = [
    `${capability.id}-receive-feedback`,
    `${capability.id}-provide-input`,
    `${capability.id}-execute`,
  ];

  return featureJourneyGraphSchema.parse({
    featureId: capability.id,
    featureName: capability.name,
    userGoal: capability.userGoals[0] ?? `完成${capability.name}`,
    entryPoints: capability.entryPoints,
    prerequisites: capability.dependencies,
    primaryPath,
    alternativePaths: [],
    successEndStates: capability.successConditions,
    failureEndStates: capability.failureConditions,
    deadEnds: capability.failureConditions,
    recoveryPaths: [recovery],
    steps,
    nextActions: followUpConditions(capability),
    completionDefinition: {
      technical: { conditions: ['数据或处理流程成功完成'], complete: null, evidence: [] },
      interface: { conditions: ['页面显示结果且没有未处理错误'], complete: null, evidence: [] },
      userGoal: { conditions: capability.successConditions, complete: null, evidence: [] },
      followUp: { conditions: followUpConditions(capability), complete: null, evidence: [] },
    },
    approvalStatus: capability.approvalStatus,
  });
}

export function buildFeatureJourneyGraphs(blueprint: EvalBlueprint): FeatureJourneyGraph[] {
  return blueprint.capabilities.map(buildFeatureJourneyGraph);
}
