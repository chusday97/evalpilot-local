import { describe, expect, it } from 'vitest';
import type { ProjectBackground } from '../types.js';
import { buildEvalBlueprint, renderBlueprintMarkdown } from '../src/generation/blueprint-builder.js';

const background: ProjectBackground = {
  projectName: 'Fixture',
  projectType: 'Web 产品',
  currentStatus: 'verified',
  problem: 'Test the product',
  targetUsers: ['待确认'],
  userTasks: ['使用首页', '使用搜索'],
  capabilities: [
    {
      id: 'cap-home',
      name: '首页',
      description: '入口',
      status: 'verified',
      routes: ['/'],
      evidence: [{ claim: 'route', sourceType: 'repository', source: 'App.tsx', status: 'verified' }],
      dependencies: [],
      risks: [],
    },
    {
      id: 'cap-search',
      name: '搜索',
      description: '搜索页',
      status: 'verified',
      routes: ['/search'],
      evidence: [{ claim: 'route', sourceType: 'repository', source: 'App.tsx', status: 'verified' }],
      dependencies: [],
      risks: [],
    },
  ],
  corePages: ['/', '/search'],
  primaryJourneys: ['首页到搜索'],
  aiResponsibilities: [],
  ruleResponsibilities: [],
  externalDependencies: [],
  highRiskOperations: [],
  knownLimitations: [],
  assumptions: [],
  unknowns: ['业务硬约束'],
  evidence: [{ claim: 'route', sourceType: 'repository', source: 'App.tsx', status: 'verified' }],
  fieldStatuses: {
    projectName: 'verified', projectType: 'verified', currentStatus: 'verified', problem: 'declared', targetUsers: 'unknown',
    userTasks: 'inferred', capabilities: 'verified', corePages: 'verified', primaryJourneys: 'inferred', aiResponsibilities: 'unknown',
    ruleResponsibilities: 'unknown', externalDependencies: 'verified', highRiskOperations: 'verified', knownLimitations: 'verified',
    assumptions: 'inferred', unknowns: 'unknown', evidence: 'verified',
  },
  fieldEvidence: Object.fromEntries([
    'projectName', 'projectType', 'currentStatus', 'problem', 'targetUsers', 'userTasks', 'capabilities', 'corePages',
    'primaryJourneys', 'aiResponsibilities', 'ruleResponsibilities', 'externalDependencies', 'highRiskOperations',
    'knownLimitations', 'assumptions', 'unknowns', 'evidence',
  ].map((field) => [field, [{ claim: field, sourceType: 'repository' as const, source: 'App.tsx', status: 'verified' as const }]])),
  generatedAt: new Date().toISOString(),
};

describe('blueprint generation', () => {
  it('creates auditable capabilities instead of test cases', () => {
    const blueprint = buildEvalBlueprint(background);
    expect(blueprint.capabilities).toHaveLength(2);
    expect(blueprint.capabilities[0]).toMatchObject({ importance: 'high', approvalStatus: 'needs_human_review' });
    expect(blueprint.capabilities[1]).toMatchObject({ importance: 'critical' });
    expect(blueprint.capabilities.every((item) => item.hardConstraints.length > 0)).toBe(true);
    expect(blueprint.capabilities.every((item) => item.requiredInputQualities.length > 0)).toBe(true);
    expect(blueprint.releaseGates).toEqual(expect.arrayContaining(['P0 问题数量必须为 0']));
    expect(blueprint.approvalStatus).toBe('needs_human_review');
  });

  it('selects a non-authenticated business route as the default critical capability', () => {
    const otherProduct = {
      ...background,
      capabilities: [
        { ...background.capabilities[0]!, routes: ['/'], name: '首页' },
        { ...background.capabilities[1]!, id: 'cap-login', routes: ['/login'], name: '登录' },
        { ...background.capabilities[1]!, id: 'cap-orders', routes: ['/orders'], name: '订单' },
      ],
    };
    const blueprint = buildEvalBlueprint(otherProduct);
    expect(blueprint.capabilities.map((item) => [item.name, item.importance])).toEqual([
      ['首页', 'high'], ['登录', 'high'], ['订单', 'critical'],
    ]);
  });

  it('renders scope, conditions, graders, and release gates', () => {
    const markdown = renderBlueprintMarkdown(buildEvalBlueprint(background));
    expect(markdown).toContain('本文件定义评测边界与门槛，不是测试案例集合');
    expect(markdown).toContain('## 上线门槛');
    expect(markdown).toContain('no_forbidden_high_risk_action');
  });
});
