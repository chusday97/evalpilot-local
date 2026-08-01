import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EvalBlueprint, ProjectBackground } from '../types.js';
import { generateAndSaveBaseline, generateBaselineCases } from '../src/eval-set/eval-set-generator.js';
import { loadEvalSetCases, loadEvalSetManifest } from '../src/eval-set/eval-set-store.js';
import { buildProductModel } from '../src/product-model/product-model-builder.js';
import { loadProductModel, saveProductModel } from '../src/product-model/product-model-store.js';

const now = '2026-08-01T11:00:00.000Z';
const evidence = { claim: '代码定义 /create 路由', sourceType: 'repository' as const, source: 'src/routes.ts', status: 'verified' as const };

function background(): ProjectBackground {
  const fieldNames = ['projectName', 'projectType', 'currentStatus', 'problem', 'targetUsers', 'userTasks', 'capabilities', 'corePages', 'primaryJourneys', 'aiResponsibilities', 'ruleResponsibilities', 'externalDependencies', 'highRiskOperations', 'knownLimitations', 'assumptions', 'unknowns', 'evidence'];
  return {
    projectName: 'Fixture Product', projectType: 'Web 产品', currentStatus: 'verified', problem: '用户需要创建项目', targetUsers: ['首次使用者'], userTasks: ['创建第一份项目'],
    capabilities: [{ id: 'cap-create', name: '创建项目', description: '通过 /create 创建项目', status: 'verified', routes: ['/create'], evidence: [evidence], dependencies: [], risks: [] }],
    corePages: ['/create'], primaryJourneys: ['进入创建页并完成创建'], aiResponsibilities: [], ruleResponsibilities: [], externalDependencies: [], highRiskOperations: [], knownLimitations: [], assumptions: [], unknowns: ['是否必须登录'], evidence: [evidence],
    fieldStatuses: Object.fromEntries(fieldNames.map((name) => [name, name === 'targetUsers' ? 'declared' : name === 'ruleResponsibilities' ? 'unknown' : 'verified'])),
    fieldEvidence: Object.fromEntries(fieldNames.map((name) => [name, [evidence]])), generatedAt: now,
  };
}

function blueprint(): EvalBlueprint {
  return {
    projectName: 'Fixture Product', inScope: ['创建'], outOfScope: [],
    capabilities: [{ id: 'cap-create', name: '创建项目', importance: 'critical', userGoals: ['创建第一份项目'], entryPoints: ['/create'], successConditions: ['创建结果可见', '提供明确下一步'], hardConstraints: ['不得自动发布'], failureConditions: ['没有结果'], dependencies: [], requiredPersonas: ['new'], requiredInputQualities: ['完整'], requiredSystemStates: ['正常'], graders: ['semantic'], approvalStatus: 'needs_human_review' }],
    scenarioDimensions: {}, scoring: { hardAssertions: [], rubricItems: [] }, coverageTargets: {}, releaseGates: [], approvalStatus: 'needs_human_review', generatedAt: now,
  };
}

describe('Product Model and Baseline Eval Set', () => {
  it('converts route evidence into task-level capabilities without treating the route as the task', () => {
    const model = buildProductModel({ projectId: 'project-fixture', background: background(), blueprint: blueprint(), generatedAt: now });
    expect(model.capabilities[0]).toMatchObject({ capabilityId: 'cap-create', routes: ['/create'], supportedTasks: ['task-create-1'] });
    expect(model.userTasks[0]).toMatchObject({ taskId: 'task-create-1', goal: '创建第一份项目', needsHumanReview: true });
    expect(model.unknowns[0]?.question).toBe('是否必须登录');
  });

  it('generates stable baseline cases with a complete Oracle and retained review marker', () => {
    const model = buildProductModel({ projectId: 'project-fixture', background: background(), blueprint: blueprint(), generatedAt: now });
    const cases = generateBaselineCases(model, now);
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ setType: 'baseline', status: 'stable', needsHumanReview: true, origin: { type: 'generated_from_product_model', productModelVersion: 1 } });
    expect(cases[0]?.oracle.expectedOutcome).toEqual(['创建结果可见', '提供明确下一步']);
    expect(cases[0]?.oracle.semanticRubric.length).toBeGreaterThan(0);
    expect(cases[0]?.oracle.inconclusiveWhen.length).toBeGreaterThan(0);
  });

  it('persists the model and regenerates the same baseline without duplicate manifest entries', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-baseline-'));
    const model = buildProductModel({ projectId: 'project-fixture', background: background(), blueprint: blueprint(), generatedAt: now });
    await saveProductModel(outputDir, model);
    await generateAndSaveBaseline(outputDir, model, now);
    await generateAndSaveBaseline(outputDir, model, now);
    expect(await loadProductModel(outputDir, 1)).toEqual(model);
    expect(await loadEvalSetCases(outputDir)).toHaveLength(1);
    expect((await loadEvalSetManifest(outputDir)).cases).toHaveLength(1);
  });
});
