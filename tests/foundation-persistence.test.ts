import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  Badcase,
  CoverageMatrix,
  EvalCase,
  EvalCaseResult,
  EvaluationSession,
  ProductModel,
} from '../types.js';
import { loadBadcase, listBadcases, saveBadcase } from '../src/badcase/badcase-store.js';
import { badcaseSchema } from '../src/badcase/schemas.js';
import { loadLatestCoverageMatrix, saveCoverageMatrix } from '../src/eval-set/coverage-store.js';
import { loadEvalCase, loadEvalSetCases, loadEvalSetManifest, saveEvalCase } from '../src/eval-set/eval-set-store.js';
import { coverageMatrixSchema, evalCaseSchema } from '../src/eval-set/schemas.js';
import { loadEvalCaseResult, saveEvalCaseResult } from '../src/judge/eval-result-store.js';
import { evalCaseResultSchema } from '../src/judge/schemas.js';
import { loadProductModel, listProductModelVersions, saveProductModel } from '../src/product-model/product-model-store.js';
import { productModelSchema } from '../src/product-model/schemas.js';
import { ensureDirectory, readJsonLinesFile } from '../src/utils/file-system.js';

const now = '2026-08-01T08:00:00.000Z';
const evidence = [{ claim: '首页存在创建入口', sourceType: 'browser' as const, source: 'evidence/pages.json', status: 'verified' as const }];

function productModel(): ProductModel {
  return {
    projectId: 'project-demo', version: 1, generatedAt: now, productName: 'Demo', productType: 'Web application',
    targetUsers: [{ userTypeId: 'user-new', name: '新用户', description: '首次使用产品', goals: ['完成创建'], evidenceStatus: 'declared', evidence, needsHumanReview: false }],
    capabilities: [{ capabilityId: 'cap-create', name: '创建内容', description: '完成一次创建', routes: ['/create'], entryPoints: ['首页按钮'], userGoals: ['获得结果'], supportedTasks: ['task-create'], importance: 'critical', evidenceStatus: 'verified', evidence, needsHumanReview: false }],
    userTasks: [{ taskId: 'task-create', capabilityId: 'cap-create', name: '首次创建', goal: '获得第一份结果', preconditions: ['项目已启动'], successConditions: ['结果可见'], evidenceStatus: 'declared', evidence, needsHumanReview: false }],
    businessRules: [{ ruleId: 'rule-save', statement: '创建结果必须可见', evidenceStatus: 'declared', evidence, needsHumanReview: false }],
    knownRisks: [{ riskId: 'risk-empty', title: '空结果', description: '提交后可能没有反馈', severity: 'P1', evidenceStatus: 'inferred', evidence, needsHumanReview: true }],
    unknowns: [{ unknownId: 'unknown-auth', question: '是否必须登录', impact: '影响前置条件', resolutionHint: '请产品负责人确认' }], evidence,
  };
}

function evalCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    caseId: 'case-create', projectId: 'project-demo', setType: 'baseline', status: 'stable',
    origin: { type: 'generated_from_product_model', productModelVersion: 1 }, capabilityId: 'cap-create', taskId: 'task-create',
    title: '新用户完成首次创建', hypothesis: '新用户可以从首页完成创建', persona: { personaId: 'user-new', name: '新用户', knowledgeLevel: 'low', patienceTurns: 3, retryTolerance: 1, privacySensitivity: 'medium', behaviorPolicy: ['只使用可见入口'], exitConditions: ['证据不足时退出'] },
    goal: '获得第一份结果', knownInformation: {}, preconditions: ['项目已启动'],
    oracle: { expectedOutcome: ['显示创建结果'], mustObserve: ['结果标题'], mustNotObserve: ['未处理异常'], businessRules: ['结果必须可见'], semanticRubric: ['用户能确认任务已经完成'], deterministicAssertions: [{ assertionId: 'assert-result', type: 'text_visible', target: '结果标题', expected: true, negated: false }], inconclusiveWhen: ['目标服务断开'] },
    coverageDimensions: [{ dimension: 'capability', value: 'cap-create' }, { dimension: 'persona', value: 'user-new' }], riskLevel: 'P1', generationReason: '覆盖关键用户任务', version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 2, lastExecutedAt: null },
    regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: now, updatedAt: now, ...overrides,
  };
}

function evalResult(): EvalCaseResult {
  return {
    runId: 'run-create', caseId: 'case-create', verdict: 'fail', failureSource: 'product', severity: 'P1',
    deterministic: { checks: [{ assertionId: 'assert-result', verdict: 'fail', summary: '结果标题未出现', evidenceRefs: ['screenshots/final.png'] }], hardFailure: true, severity: 'P1', evidenceRefs: ['screenshots/final.png'] },
    semantic: { verdict: 'fail', taskCompletion: 'failed', summary: '用户没有看到结果', whatWorked: ['提交成功触发'], whatFailed: ['结果不可见'], whyItMatters: ['用户无法确认是否完成'], confirmedFacts: ['点击已发生'], hypotheses: [{ hypothesis: '前端状态未更新', confidence: 0.6, supportingEvidence: ['页面文本不变'], contradictingEvidence: [], howToVerify: ['检查提交后的状态更新'] }], unknowns: ['请求是否返回'], evidenceRefs: ['screenshots/final.png'], confidence: 0.8 },
    evidencePacketPath: 'runs/run-create/evidence-packet.json', createdAt: now,
  };
}

function badcase(): Badcase {
  return {
    badcaseId: 'badcase-create', projectId: 'project-demo', caseId: 'case-create', runId: 'run-create', category: 'interaction', title: '提交后没有结果', observedFailure: '点击后页面没有反馈', userImpact: '用户无法完成首次创建', severity: 'P1', confirmedFacts: ['点击已发生'], rootCauseHypotheses: [{ hypothesis: '前端状态未更新', confidence: 0.6, supportingEvidence: ['页面文本不变'], contradictingEvidence: [], howToVerify: ['检查状态更新'] }], unknowns: ['请求是否返回'], evidenceRefs: ['runs/run-create/evidence-packet.json'], fixStatus: 'open', regressionCaseId: null, createdAt: now, updatedAt: now,
  };
}

function coverage(): CoverageMatrix {
  return {
    projectId: 'project-demo', generatedAt: now,
    dimensions: [{ dimension: 'persona', targetValues: ['user-new', 'user-returning'], coveredValues: ['user-new'], missingValues: ['user-returning'], coverageRatio: 0.5 }],
    gaps: [{ gapId: 'gap-persona', kind: 'missing_asset', capabilityId: 'cap-create', dimension: 'persona', missingValue: 'user-returning', priority: 'high', reason: '尚未验证回访用户', candidateCaseIds: [] }],
    totalTargetCells: 2, assetCoveredCells: 1, executedCells: 1, verifiedCells: 1, coveredCells: 1,
    assetCoverageRatio: 0.5, executionCoverageRatio: 0.5, verifiedCoverageRatio: 0.5,
    cells: [{ cellId: 'cell-persona-new', capabilityId: 'cap-create', dimension: 'persona', value: 'user-new', assetStatus: 'stable', executionStatus: 'pass', caseIds: ['case-create'], latestRunId: 'run-create', latestResultAt: now, verified: true }, { cellId: 'cell-persona-returning', capabilityId: 'cap-create', dimension: 'persona', value: 'user-returning', assetStatus: 'missing', executionStatus: 'not_run', caseIds: [], latestRunId: null, latestResultAt: null, verified: false }], coverageRatio: 0.5,
  };
}

describe('EvalPilot Next Phase 0 schemas', () => {
  it('parses each new top-level asset', () => {
    expect(productModelSchema.parse(productModel()).version).toBe(1);
    expect(evalCaseSchema.parse(evalCase()).status).toBe('stable');
    expect(evalCaseResultSchema.parse(evalResult()).verdict).toBe('fail');
    expect(badcaseSchema.parse(badcase()).fixStatus).toBe('open');
    expect(coverageMatrixSchema.parse(coverage()).coverageRatio).toBe(0.5);
  });

  it('rejects invalid lifecycle lineage and impossible coverage', () => {
    expect(() => evalCaseSchema.parse(evalCase({ setType: 'regression' }))).toThrow(/Regression/);
    expect(() => evalCaseSchema.parse(evalCase({ status: 'retired' }))).toThrow(/退役/);
    expect(() => coverageMatrixSchema.parse({ ...coverage(), coveredCells: 3 })).toThrow(/超过/);
  });
});

describe('EvalPilot Next Phase 0 persistence', () => {
  it('round-trips all new assets and keeps the manifest synchronized', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-foundation-'));
    await saveProductModel(outputDir, productModel());
    await saveEvalCase(outputDir, evalCase());
    await saveEvalCaseResult(outputDir, evalResult());
    await saveBadcase(outputDir, badcase());
    await saveCoverageMatrix(outputDir, coverage());

    expect(await loadProductModel(outputDir, 1)).toEqual(productModel());
    expect(await listProductModelVersions(outputDir)).toEqual([1]);
    expect(await loadEvalCase(outputDir, 'baseline', 'case-create')).toEqual(evalCase());
    expect(await loadEvalSetCases(outputDir)).toEqual([evalCase()]);
    expect(await loadEvalSetManifest(outputDir)).toMatchObject({ projectId: 'project-demo', version: 1, cases: [{ caseId: 'case-create', setType: 'baseline' }] });
    expect(await loadEvalCaseResult(outputDir, 'run-create')).toEqual(evalResult());
    expect(await loadBadcase(outputDir, 'badcase-create')).toEqual(badcase());
    expect(await listBadcases(outputDir)).toEqual([badcase()]);
    expect(await loadLatestCoverageMatrix(outputDir)).toEqual(coverage());
    expect((await readdir(resolve(outputDir, 'coverage', 'history'))).filter((name) => name.endsWith('.json'))).toHaveLength(1);
  });

  it('does not rewrite existing evaluation history', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-legacy-safe-'));
    const historyPath = resolve(outputDir, 'evaluations', 'sessions.jsonl');
    await ensureDirectory(resolve(outputDir, 'evaluations'));
    const legacy = { evaluationId: 'legacy-1', projectId: 'project-demo', depth: 'core', capabilityIds: ['cap-create'], capabilityNames: ['创建内容'], status: 'completed', currentStage: 'report', stages: [], runIds: ['legacy-run'], startedAt: now, completedAt: now, error: null };
    const original = `${JSON.stringify(legacy)}\n`;
    await writeFile(historyPath, original);

    await saveProductModel(outputDir, productModel());
    await saveEvalCase(outputDir, evalCase());

    expect(await readFile(historyPath, 'utf8')).toBe(original);
    const loaded = await readJsonLinesFile<EvaluationSession>(historyPath);
    expect(loaded[0]).toMatchObject({ evaluationId: 'legacy-1', capabilityNames: ['创建内容'] });
  });

  it('rejects unsafe storage identifiers before reading files', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-path-safe-'));
    await expect(loadEvalCase(outputDir, 'baseline', '../outside')).rejects.toThrow();
    await expect(loadEvalCaseResult(outputDir, '../outside')).rejects.toThrow();
    await expect(loadBadcase(outputDir, '../outside')).rejects.toThrow();
  });

  it('rejects cross-project writes before creating an alien case file', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-project-safe-'));
    await saveEvalCase(outputDir, evalCase());
    await expect(saveEvalCase(outputDir, evalCase({ caseId: 'case-alien', projectId: 'project-alien' }))).rejects.toThrow(/不能写入/);
    await expect(readFile(resolve(outputDir, 'eval-sets', 'baseline', 'case-alien.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(saveEvalCase(outputDir, evalCase({ setType: 'challenge' }))).rejects.toThrow(/不支持静默移动集合/);
  });
});
