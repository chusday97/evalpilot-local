import { resolve } from 'node:path';
import type { BlueprintCapability, EvalBlueprint, EvalPilotConfig, Importance, ProjectBackground } from '../../types.js';
import { evalBlueprintSchema } from '../schemas/blueprint.js';
import { EvalPilotError } from '../utils/errors.js';
import { readYamlFile, writeTextAtomic, writeYamlAtomic } from '../utils/file-system.js';

function isAuthenticationRoute(routes: string[]): boolean {
  return routes.some((route) => /(^|\/)(login|sign-?in|auth|register|logout)(\/|$)/i.test(route));
}

function importanceFor(index: number, primaryIndex: number): Importance {
  if (index === primaryIndex) return 'critical';
  if (index < 3) return 'high';
  return 'medium';
}

export function buildEvalBlueprint(background: ProjectBackground): EvalBlueprint {
  const firstBusinessIndex = background.capabilities.findIndex((capability) => !capability.routes.includes('/') && !isAuthenticationRoute(capability.routes));
  const primaryIndex = firstBusinessIndex >= 0 ? firstBusinessIndex : 0;
  const capabilities: BlueprintCapability[] = background.capabilities.map((capability, index) => ({
    id: capability.id,
    name: capability.name,
    importance: importanceFor(index, primaryIndex),
    userGoals: [`用户可以进入并完成${capability.name}的主要任务`],
    entryPoints: capability.routes.length ? capability.routes : background.corePages.slice(0, 1),
    successConditions: [
      '入口页面可通过 Chromium 正常到达',
      '主要内容和核心操作元素可见',
      '执行后页面提供明确结果或下一步',
    ],
    hardConstraints: [
      '不得未经用户确认执行删除、支付、发送、发布等高风险操作',
      '业务专属硬约束尚未由直接证据确认，测试前需要人工审核',
    ],
    failureConditions: [
      '入口不可访问或页面崩溃',
      '核心操作不存在、不可点击或无结果反馈',
      '产生未处理的控制台错误或关键网络失败',
      '异常后没有提示、重试或安全降级路径',
    ],
    dependencies: capability.dependencies,
    requiredPersonas: ['persona-new-user', 'persona-skilled-user', 'persona-low-patience'],
    requiredInputQualities: ['完整', '缺失', '模糊', '冲突'],
    requiredSystemStates: ['正常', '空结果', 'API 超时', 'API 非法响应'],
    graders: ['page_reached', 'critical_element_visible', 'no_unhandled_console_error', 'no_forbidden_high_risk_action'],
    approvalStatus: 'needs_human_review',
  }));

  return evalBlueprintSchema.parse({
    projectName: background.projectName,
    inScope: [
      '已识别的 Web 页面与核心入口',
      'Chromium 浏览器主路径与恢复路径',
      'API 空数据、超时和错误结构',
      '正常、模糊、边界、无关和越界用户场景',
    ],
    outOfScope: [
      '生产压力测试',
      '移动端原生应用',
      '完整安全红队',
      '自动修改目标项目或生产数据',
      '用户留存、付费或商业结果预测',
    ],
    capabilities,
    scenarioDimensions: {
      userType: ['正常新用户', '熟练用户', '信息模糊用户', '低耐心用户', '目标不明确用户', '非目标用户', '无关需求用户', '越界用户', '恶意用户'],
      intentType: ['核心任务', '相邻任务', '修改已有结果', '撤销', '返回', '不支持任务', '完全无关请求', '违反规则请求'],
      inputQuality: ['完整', '缺失', '模糊', '冲突', '错别字', '多语言', '超短', '超长', '大量无关内容', '重复提交'],
      systemState: ['正常', '空结果', 'API 超时', 'API 非法响应', '网络中断', '登录失效', '页面刷新', '重复请求', '外部工具不可用'],
      journeyStage: ['首次进入', 'Onboarding', '核心任务', '修改结果', '保存', '返回', '中断恢复', '退出重进'],
      expectedHandling: ['完成任务', '部分完成', '要求补充', '提供替代方案', '拒绝', '引导回支持范围', '提示重试', '阻止高风险操作'],
    },
    scoring: {
      hardAssertions: [
        '页面到达且关键元素可见',
        '没有执行未经确认的高风险操作',
        '没有未处理的控制台错误和关键网络失败',
        '异常状态有明确提示和恢复路径',
      ],
      rubricItems: ['任务完成度', '准确性', '解释清晰度', '不确定性表达', '用户成本', '错误恢复质量'],
    },
    coverageTargets: {
      criticalCapabilities: 1,
      requiredPersonas: 1,
      primaryInputQualities: 0.8,
      requiredSystemStates: 1,
      unsupportedRequests: 1,
      hardConstraints: 1,
    },
    releaseGates: [
      'P0 问题数量必须为 0',
      '未豁免的 P1 问题数量必须为 0',
      '所有 critical 能力至少有 1 条真实浏览器通过案例',
      '三种 MVP API 异常均有执行结果和恢复证据',
      '所有 needs_human_review 的业务硬约束必须在上线前由人确认',
    ],
    approvalStatus: 'needs_human_review',
    generatedAt: new Date().toISOString(),
  });
}

function list(items: string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

export function renderBlueprintMarkdown(blueprint: EvalBlueprint): string {
  return `# ${blueprint.projectName} — 项目评测蓝图\n\n` +
    `> 审批状态：${blueprint.approvalStatus}。本文件定义评测边界与门槛，不是测试案例集合。\n\n` +
    `## 测试范围\n\n${list(blueprint.inScope)}\n\n## 不测试范围\n\n${list(blueprint.outOfScope)}\n\n` +
    `## 功能蓝图\n\n${blueprint.capabilities.map((capability) => `### ${capability.name}（${capability.importance}）\n\n- ID：${capability.id}\n- 审批：${capability.approvalStatus}\n- 入口：${capability.entryPoints.join(', ')}\n- 用户目标：${capability.userGoals.join('；')}\n- 成功条件：\n${list(capability.successConditions)}\n- 硬约束：\n${list(capability.hardConstraints)}\n- 失败条件：\n${list(capability.failureConditions)}\n- Persona：${capability.requiredPersonas.join(', ')}\n- 系统状态：${capability.requiredSystemStates.join(', ')}\n- 评分器：${capability.graders.join(', ')}`).join('\n\n')}\n\n` +
    `## 评分方式\n\n### 硬性断言\n\n${list(blueprint.scoring.hardAssertions)}\n\n### 人工 Rubric\n\n${list(blueprint.scoring.rubricItems)}\n\n` +
    `## 上线门槛\n\n${list(blueprint.releaseGates)}\n`;
}

export async function generateBlueprint(config: EvalPilotConfig): Promise<EvalBlueprint> {
  let background: ProjectBackground;
  try {
    background = await readYamlFile(resolve(config.outputDir, 'project-background.yaml'));
  } catch (error) {
    throw new EvalPilotError(`无法读取产品背景，请先运行 generate-background。${String(error)}`, 'BACKGROUND_REQUIRED');
  }
  const blueprint = buildEvalBlueprint(background);
  await Promise.all([
    writeYamlAtomic(resolve(config.outputDir, 'eval-blueprint.yaml'), blueprint),
    writeTextAtomic(resolve(config.outputDir, 'EVAL_BLUEPRINT.md'), renderBlueprintMarkdown(blueprint)),
  ]);
  return blueprint;
}
