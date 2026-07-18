import { describe, expect, it } from 'vitest';
import type { EvalBlueprint } from '../types.js';
import { calculateCoverage } from '../src/evaluation/coverage-calculator.js';
import { buildPersonas } from '../src/generation/persona-builder.js';
import { buildScenarios } from '../src/generation/scenario-builder.js';

const blueprint: EvalBlueprint = {
  projectName: 'Fixture',
  inScope: ['web'],
  outOfScope: ['native'],
  capabilities: Array.from({ length: 9 }, (_, index) => ({
    id: `cap-${index + 1}`,
    name: `能力 ${index + 1}`,
    importance: index < 2 ? 'critical' : 'high',
    userGoals: ['complete'],
    entryPoints: [index === 0 ? '/' : `/route-${index + 1}`],
    successConditions: ['visible'],
    hardConstraints: ['safe'],
    failureConditions: ['crash'],
    dependencies: [],
    requiredPersonas: ['persona-new-user'],
    requiredInputQualities: ['完整', '缺失'],
    requiredSystemStates: ['正常'],
    graders: ['page_reached'],
    approvalStatus: 'needs_human_review',
  })),
  scenarioDimensions: {
    userType: ['正常新用户'],
    intentType: ['核心任务', '相邻任务', '修改已有结果', '撤销', '返回', '不支持任务', '完全无关请求', '违反规则请求'],
    inputQuality: ['完整', '缺失', '模糊', '冲突', '错别字', '多语言', '超短', '超长', '大量无关内容', '重复提交'],
    systemState: ['正常', '空结果', 'API 超时', 'API 非法响应', '网络中断', '登录失效', '页面刷新', '重复请求', '外部工具不可用'],
    journeyStage: ['首次进入', 'Onboarding', '核心任务', '修改结果', '保存', '返回', '中断恢复', '退出重进'],
  },
  scoring: { hardAssertions: ['safe'], rubricItems: ['quality'] },
  coverageTargets: { critical: 1 },
  releaseGates: ['P0=0'],
  approvalStatus: 'needs_human_review',
  generatedAt: new Date().toISOString(),
};

describe('persona and scenario generation', () => {
  it('creates eight behavior personas with the required roles', () => {
    const personas = buildPersonas();
    expect(personas).toHaveLength(8);
    expect(personas.map((persona) => persona.personaId)).toEqual(
      expect.arrayContaining(['persona-new-user', 'persona-vague-user', 'persona-low-patience', 'persona-skilled-user', 'persona-ambiguous-goal', 'persona-non-target', 'persona-unrelated', 'persona-malicious']),
    );
    expect(personas.every((persona) => persona.behaviorPolicy.length > 0 && persona.exitConditions.length > 0)).toBe(true);
  });

  it('creates 40 non-duplicate cases with the requested category ratio and 12 automated cases', () => {
    const scenarios = buildScenarios(blueprint, buildPersonas());
    expect(scenarios).toHaveLength(40);
    expect(new Set(scenarios.map((scenario) => scenario.title)).size).toBe(40);
    expect(scenarios.filter((scenario) => scenario.automationStatus === 'automated')).toHaveLength(12);
    expect(scenarios.filter((scenario) => scenario.systemState === '空结果')).toHaveLength(1);
    expect(scenarios.filter((scenario) => scenario.systemState === 'API 超时')).toHaveLength(1);
    expect(scenarios.filter((scenario) => scenario.systemState === 'API 非法响应')).toHaveLength(1);
    expect(scenarios.filter((scenario) => scenario.severityIfFailed === 'P0')).toHaveLength(1);
  });

  it('calculates coverage without inventing missing dimensions', () => {
    const scenarios = buildScenarios(blueprint, buildPersonas());
    const personas = buildPersonas();
    const coverage = calculateCoverage(scenarios, blueprint, personas);
    expect(coverage.totalCases).toBe(40);
    expect(coverage.automatedCases).toBe(12);
    expect(coverage.dimensions.capabilities?.ratio).toBe(1);
    expect(coverage.dimensions.systemState?.missing).not.toContain('API 超时');
    expect(coverage.dimensions.intentType?.ratio).toBe(1);
    expect(coverage.dimensions.journeyStage?.missing).toEqual([]);
    expect(coverage.dimensions.personas?.missing).toEqual([]);
  });
});
