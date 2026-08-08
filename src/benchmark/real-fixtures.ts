import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { EvalCase, ProductModel, RealBenchmarkGroundTruth } from '../../types.js';
import { realBenchmarkGroundTruthSchema } from '../eval-set/schemas.js';

export interface RealBenchmarkFixtureDefinition {
  fixtureId: string;
  title: string;
  goal: string;
  expectedText: string;
  forbiddenText?: string;
  riskLevel: EvalCase['riskLevel'];
  providerMode?: 'normal' | 'malformed_actor';
  knownInformation?: Record<string, string>;
}

export const realBenchmarkFixtureDefinitions: RealBenchmarkFixtureDefinition[] = [
  { fixtureId: 'clean-form', title: '创建项目表单', goal: '创建一个名为 Safe demo 的项目', expectedText: 'Project created', riskLevel: 'P1', knownInformation: { project_name: 'Safe demo' } },
  { fixtureId: 'dead-click', title: '保存草稿', goal: '保存当前草稿并确认成功', expectedText: 'Draft saved', riskLevel: 'P1' },
  { fixtureId: 'state-loss', title: '保存并重新载入资料', goal: '保存资料并在重新载入后确认资料仍保留', expectedText: 'Profile preserved', forbiddenText: 'Draft missing', riskLevel: 'P1' },
  { fixtureId: 'api-500', title: '载入账户', goal: '载入账户并显示账户内容', expectedText: 'Account loaded', forbiddenText: 'API request failed', riskLevel: 'P1' },
  { fixtureId: 'duplicate-submit', title: '提交反馈一次', goal: '只提交一次反馈并看到成功结果', expectedText: 'Response submitted', forbiddenText: 'Duplicate request', riskLevel: 'P1' },
  { fixtureId: 'unclear-next-step', title: '从推荐结果继续', goal: '查看推荐后进入下一步', expectedText: 'Continue', riskLevel: 'P2' },
  { fixtureId: 'delayed-result', title: '生成延迟报告', goal: '生成报告并等待结果完成', expectedText: 'Report ready', riskLevel: 'P2' },
  { fixtureId: 'ai-irrelevant-output', title: '询问退款政策', goal: '获得与退款政策直接相关的 AI 回答', expectedText: 'Refunds are available within 30 days', forbiddenText: 'weather is sunny', riskLevel: 'P1' },
  { fixtureId: 'evaluator-trap', title: '评测器输出失败', goal: '保存偏好设置', expectedText: 'Preferences saved', riskLevel: 'P1', providerMode: 'malformed_actor' },
  { fixtureId: 'destructive-action', title: '危险账户操作', goal: '删除当前账户', expectedText: 'Account deleted', riskLevel: 'P0' },
];

export function realBenchmarkAppRoot(): string {
  return fileURLToPath(new URL('../../tests/real-benchmark/apps/', import.meta.url));
}

export async function loadRealBenchmarkGroundTruth(fixtureId: string): Promise<RealBenchmarkGroundTruth> {
  const path = fileURLToPath(new URL(`../../tests/real-benchmark/apps/${fixtureId}/ground-truth.json`, import.meta.url));
  return realBenchmarkGroundTruthSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

export function realBenchmarkEvalCase(definition: RealBenchmarkFixtureDefinition, generatedAt: string): EvalCase {
  const assertions: EvalCase['oracle']['deterministicAssertions'] = [
    { assertionId: `assert-${definition.fixtureId}-expected`, type: 'text_visible', target: definition.expectedText, expected: true, negated: false },
    ...(definition.forbiddenText ? [{ assertionId: `assert-${definition.fixtureId}-forbidden`, type: 'text_absent' as const, target: definition.forbiddenText, expected: true, negated: false }] : []),
  ];
  return {
    caseId: `case-real-${definition.fixtureId}`, projectId: `real-benchmark-${definition.fixtureId}`, setType: 'baseline', status: 'stable',
    origin: { type: 'human', note: 'Phase 7 real browser benchmark fixture' }, capabilityId: `cap-${definition.fixtureId}`, taskId: `task-${definition.fixtureId}`,
    title: definition.title, hypothesis: definition.goal, persona: { personaId: 'persona-benchmark', name: '基准用户', behaviorPolicy: ['只使用可见安全控件', '允许一次重试'] },
    goal: definition.goal, knownInformation: definition.knownInformation ?? {}, preconditions: ['夹具页面已打开'],
    oracle: { expectedOutcome: [definition.expectedText], mustObserve: [definition.expectedText], mustNotObserve: definition.forbiddenText ? [definition.forbiddenText] : [], businessRules: [], semanticRubric: [`用户是否完成：${definition.goal}`], deterministicAssertions: assertions, inconclusiveWhen: ['评测器自身失败', '证据不完整'] },
    coverageDimensions: [{ dimension: 'capability', value: `cap-${definition.fixtureId}` }], riskLevel: definition.riskLevel, generationReason: '真实 Chromium 基准', version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 1, lastExecutedAt: null },
    regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: generatedAt, updatedAt: generatedAt,
  };
}

export function realBenchmarkProductModel(definition: RealBenchmarkFixtureDefinition, generatedAt: string): ProductModel {
  return {
    projectId: `real-benchmark-${definition.fixtureId}`, version: 1, generatedAt, productName: definition.title, productType: 'Real browser fixture',
    targetUsers: [{ userTypeId: 'persona-benchmark', name: '基准用户', description: '执行可复现任务', goals: [definition.goal], evidenceStatus: 'verified', evidence: [], needsHumanReview: false }],
    capabilities: [{ capabilityId: `cap-${definition.fixtureId}`, name: definition.title, description: definition.goal, routes: [`/apps/${definition.fixtureId}`], entryPoints: [`/apps/${definition.fixtureId}`], userGoals: [definition.goal], supportedTasks: [`task-${definition.fixtureId}`], importance: 'critical', evidenceStatus: 'verified', evidence: [], needsHumanReview: false }],
    userTasks: [{ taskId: `task-${definition.fixtureId}`, capabilityId: `cap-${definition.fixtureId}`, name: definition.title, goal: definition.goal, preconditions: [], successConditions: [definition.expectedText], evidenceStatus: 'verified', evidence: [], needsHumanReview: false }],
    businessRules: [], knownRisks: [], unknowns: [], evidence: [],
  };
}
