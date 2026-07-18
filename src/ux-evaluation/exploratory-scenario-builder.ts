import type { EvalBlueprint, ExploratoryScenario, Persona } from '../../types.js';
import { exploratoryScenarioSchema } from '../schemas/ux-evaluation.js';

export function buildExploratoryScenarios(blueprint: EvalBlueprint, personas: Persona[]): ExploratoryScenario[] {
  const capability = blueprint.capabilities.find((item) => item.importance === 'critical') ?? blueprint.capabilities[0];
  if (!capability) return [];
  const startingUrl = capability.entryPoints[0] ?? '/';
  return personas.map((persona, index) => exploratoryScenarioSchema.parse({
    caseId: `case-exploratory-${String(index + 1).padStart(3, '0')}`,
    type: 'exploratory_user_journey',
    title: `${persona.name}自主完成${capability.name}`,
    capability: capability.id,
    personaId: persona.personaId,
    startingUrl,
    goal: capability.userGoals[0] ?? persona.primaryGoal,
    knownInformation: {},
    allowedActions: ['查看可见内容', '点击安全链接或按钮', '填写已知信息', '返回', '重试一次', '明确放弃'],
    forbiddenActions: ['删除', '支付', '发送', '公开发布', '修改目标项目文件', '绕过权限或安全确认'],
    successConditions: capability.successConditions,
    failureConditions: [...capability.failureConditions, ...persona.exitConditions],
    abandonmentPolicy: {
      maxFailedAttempts: Math.max(1, Math.min(3, persona.patienceTurns)),
      maxClarificationTurns: Math.max(1, persona.patienceTurns),
      maxIdleTimeMs: persona.patienceTurns <= 1 ? 5_000 : 10_000,
      maxTotalActions: Math.max(8, persona.patienceTurns * 4),
      abandonOn: persona.exitConditions,
    },
    severityIfFailed: capability.importance === 'critical' ? 'P1' : 'P2',
    approvalStatus: capability.approvalStatus,
  }));
}
