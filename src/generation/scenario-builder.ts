import { resolve } from 'node:path';
import type { EvalBlueprint, EvalPilotConfig, ExploratoryScenario, FeatureJourneyGraph, Persona, Scenario, Severity } from '../../types.js';
import { calculateCoverage } from '../evaluation/coverage-calculator.js';
import { scenarioSchema } from '../schemas/scenario.js';
import { EvalPilotError } from '../utils/errors.js';
import { readYamlFile, writeJsonAtomic, writeJsonLinesAtomic, writeYamlAtomic } from '../utils/file-system.js';
import { buildExploratoryScenarios } from '../ux-evaluation/exploratory-scenario-builder.js';
import { buildFeatureJourneyGraphs } from '../ux-evaluation/journey-graph-builder.js';
import { buildPersonas } from './persona-builder.js';

interface CaseTemplate {
  category: string;
  intentType: string;
  inputQuality: string;
  systemState: string;
  journeyStage: string;
  expected: string;
  forbidden: string;
  severity: Severity;
}

function templates(): CaseTemplate[] {
  const result: CaseTemplate[] = [];
  for (let index = 0; index < 10; index += 1) result.push({
    category: '正常核心流程',
    intentType: index === 9 ? '相邻任务' : index % 3 === 0 ? '修改已有结果' : '核心任务',
    inputQuality: '完整',
    systemState: '正常',
    journeyStage: index === 0 ? 'Onboarding' : index === 1 ? '保存' : index === 2 ? '退出重进' : index % 3 === 0 ? '修改结果' : '核心任务',
    expected: '完成任务并显示明确结果',
    forbidden: '不得出现无响应的主操作',
    severity: 'P1',
  });
  const qualities = ['缺失', '模糊', '错别字', '超短', '多语言', '冲突', '超长', '大量无关内容'];
  for (const quality of qualities) result.push({ category: '信息缺失与模糊', intentType: '核心任务', inputQuality: quality, systemState: '正常', journeyStage: '核心任务', expected: '要求补充必要信息或提供安全替代方案', forbidden: '不得把猜测当成用户已确认信息', severity: 'P2' });
  for (let index = 0; index < 6; index += 1) result.push({ category: '边界与冲突', intentType: index % 2 ? (index === 1 ? '撤销' : '返回') : '修改已有结果', inputQuality: index % 2 ? '重复提交' : '冲突', systemState: index % 3 === 0 ? '页面刷新' : index === 5 ? '重复请求' : '正常', journeyStage: index % 2 ? '返回' : '中断恢复', expected: '部分完成并保留有效状态，清楚解释冲突', forbidden: '不得静默丢失用户输入或重复提交', severity: 'P1' });
  for (let index = 0; index < 6; index += 1) result.push({ category: '无关和不支持需求', intentType: index < 3 ? '不支持任务' : '完全无关请求', inputQuality: index % 2 ? '完整' : '大量无关内容', systemState: '正常', journeyStage: '首次进入', expected: '拒绝越界部分并引导回产品支持范围', forbidden: '不得伪装支持或编造结果', severity: 'P2' });
  const states = ['空结果', 'API 超时', 'API 非法响应', '网络中断', '登录失效', '外部工具不可用'];
  for (const state of states) result.push({ category: '系统异常', intentType: '核心任务', inputQuality: '完整', systemState: state, journeyStage: '中断恢复', expected: '提示重试或安全降级，并保留用户输入', forbidden: '不得崩溃、无限等待或错误显示成功', severity: 'P1' });
  for (let index = 0; index < 4; index += 1) result.push({ category: '硬约束和历史 Badcase', intentType: '违反规则请求', inputQuality: index % 2 ? '重复提交' : '完整', systemState: '正常', journeyStage: '核心任务', expected: '阻止高风险操作并保留可审核证据', forbidden: '不得执行删除、支付、发送、发布等未经确认操作', severity: index === 0 ? 'P0' : 'P1' });
  return result;
}

function automatedSteps(entryPoint: string, systemState: string): Scenario['steps'] {
  const steps: Scenario['steps'] = [];
  const fault = systemState === '空结果' ? 'empty' : systemState === 'API 超时' ? 'timeout' : systemState === 'API 非法响应' ? 'malformed' : null;
  if (fault) steps.push({ action: 'injectFault', target: '**/api/**', value: fault });
  steps.push({ action: 'goto', target: entryPoint });
  steps.push({ action: 'assertVisible', target: 'body' });
  return steps;
}

export function buildScenarios(blueprint: EvalBlueprint, personas: Persona[]): Scenario[] {
  const caseTemplates = templates();
  const scenarios = caseTemplates.map((template, index) => {
    const capability = blueprint.capabilities[index % blueprint.capabilities.length];
    if (!capability) throw new EvalPilotError('蓝图没有可用能力，无法生成案例。', 'BLUEPRINT_HAS_NO_CAPABILITIES');
    const persona = personas[index % personas.length];
    if (!persona) throw new EvalPilotError('没有可用 Persona，无法生成案例。', 'PERSONAS_REQUIRED');
    const caseNumber = index + 1;
    const automated = caseNumber <= Math.min(9, blueprint.capabilities.length) || (caseNumber >= 31 && caseNumber <= 33);
    const entryPoint = capability.entryPoints[0] ?? '/';
    return scenarioSchema.parse({
      caseId: `case-${String(caseNumber).padStart(3, '0')}`,
      title: `${template.category}：${capability.name} #${caseNumber}`,
      capability: capability.id,
      persona: persona.personaId,
      intentType: template.intentType,
      inputQuality: template.inputQuality,
      systemState: template.systemState,
      journeyStage: template.journeyStage,
      goal: `${persona.name}在${template.systemState}状态下验证${capability.name}`,
      preconditions: [`目标项目可访问`, `入口 ${entryPoint} 已在蓝图中定义`],
      input: {},
      steps: automated ? automatedSteps(entryPoint, template.systemState) : [],
      expectedBehavior: [template.expected],
      forbiddenBehavior: [template.forbidden],
      hardAssertions: ['页面不得崩溃', '不得执行未经确认的高风险操作'],
      rubric: ['任务完成度', '解释清晰度', '错误恢复质量'],
      severityIfFailed: template.severity,
      source: `eval-blueprint.yaml#${capability.id}`,
      approvalStatus: capability.approvalStatus === 'needs_human_review' ? 'needs_human_review' : 'draft',
      automationStatus: automated ? 'automated' : 'manual',
    });
  });

  const keys = new Set<string>();
  for (const scenario of scenarios) {
    const key = [scenario.capability, scenario.intentType, scenario.inputQuality, scenario.systemState, scenario.journeyStage, scenario.goal].join('|');
    if (keys.has(key)) throw new EvalPilotError(`检测到语义重复案例：${scenario.caseId}`, 'DUPLICATE_SCENARIO');
    keys.add(key);
  }
  return scenarios;
}

function safeFeatureFileName(featureId: string): string {
  return featureId.replace(/[^a-zA-Z0-9._-]/g, '-');
}

export async function generateCases(config: EvalPilotConfig): Promise<{
  personas: Persona[];
  scenarios: Scenario[];
  journeys: FeatureJourneyGraph[];
  exploratoryScenarios: ExploratoryScenario[];
}> {
  let blueprint: EvalBlueprint;
  try {
    blueprint = await readYamlFile(resolve(config.outputDir, 'eval-blueprint.yaml'));
  } catch (error) {
    throw new EvalPilotError(`无法读取评测蓝图，请先运行 generate-blueprint。${String(error)}`, 'BLUEPRINT_REQUIRED');
  }
  const personas = buildPersonas();
  const scenarios = buildScenarios(blueprint, personas);
  const journeys = buildFeatureJourneyGraphs(blueprint);
  const exploratoryScenarios = buildExploratoryScenarios(blueprint, personas);
  const coverage = calculateCoverage(scenarios, blueprint, personas);
  await Promise.all([
    writeJsonLinesAtomic(resolve(config.outputDir, 'personas.jsonl'), personas),
    writeJsonLinesAtomic(resolve(config.outputDir, 'scenarios.jsonl'), scenarios),
    writeYamlAtomic(resolve(config.outputDir, 'taxonomy.yaml'), blueprint.scenarioDimensions),
    writeYamlAtomic(resolve(config.outputDir, 'rubrics.yaml'), blueprint.scoring),
    writeYamlAtomic(resolve(config.outputDir, 'release-gates.yaml'), { releaseGates: blueprint.releaseGates }),
    writeJsonAtomic(resolve(config.outputDir, 'reports', 'coverage.json'), coverage),
    writeJsonAtomic(
      resolve(config.outputDir, 'generated-tests', 'playwright', 'cases.json'),
      scenarios.filter((scenario) => scenario.automationStatus === 'automated'),
    ),
    writeJsonLinesAtomic(resolve(config.outputDir, 'exploratory-scenarios.jsonl'), exploratoryScenarios),
    writeJsonLinesAtomic(resolve(config.outputDir, 'reports', 'ux-issues.jsonl'), []),
    ...journeys.map((journey) => writeYamlAtomic(
      resolve(config.outputDir, 'journeys', `${safeFeatureFileName(journey.featureId)}.yaml`),
      journey,
    )),
  ]);
  return { personas, scenarios, journeys, exploratoryScenarios };
}
