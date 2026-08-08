import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EvalCase, EvalCaseResult, ProductModel } from '../types.js';
import { recordCaseResult } from '../src/eval-set/case-lifecycle.js';
import { analyzeCoverage } from '../src/eval-set/coverage-analyzer.js';
import { loadEvalSetManifest, saveEvalCase } from '../src/eval-set/eval-set-store.js';
import { analyzePassingCase } from '../src/eval-set/pass-analyzer.js';

const now = '2026-08-01T14:00:00.000Z';
const evidence = [{ claim: '创建任务已声明', sourceType: 'document' as const, source: 'README.md', status: 'declared' as const }];

function model(): ProductModel {
  return {
    projectId: 'project-demo', version: 1, generatedAt: now, productName: 'Demo', productType: 'Web 产品',
    targetUsers: [
      { userTypeId: 'user-new', name: '新用户', description: '首次用户', goals: ['创建'], evidenceStatus: 'declared', evidence, needsHumanReview: false },
      { userTypeId: 'user-skilled', name: '熟练用户', description: '熟练用户', goals: ['快速创建'], evidenceStatus: 'declared', evidence, needsHumanReview: false },
    ],
    capabilities: [{ capabilityId: 'cap-create', name: '创建', description: '创建项目', routes: ['/create'], entryPoints: ['/create'], userGoals: ['创建'], supportedTasks: ['task-create'], importance: 'critical', evidenceStatus: 'declared', evidence, needsHumanReview: false }],
    userTasks: [{ taskId: 'task-create', capabilityId: 'cap-create', name: '创建', goal: '创建项目', preconditions: [], successConditions: ['结果可见'], evidenceStatus: 'declared', evidence, needsHumanReview: false }], businessRules: [], knownRisks: [], unknowns: [], evidence,
  };
}

function baseline(): EvalCase {
  return {
    caseId: 'case-baseline-create', projectId: 'project-demo', setType: 'baseline', status: 'stable', origin: { type: 'generated_from_product_model', productModelVersion: 1 }, capabilityId: 'cap-create', taskId: 'task-create', title: '新用户创建', hypothesis: '新用户可以创建', persona: { personaId: 'user-new', name: '新用户', behaviorPolicy: ['安全操作'] }, goal: '创建项目', knownInformation: { name: 'Demo' }, preconditions: [], oracle: { expectedOutcome: ['结果可见'], mustObserve: [], mustNotObserve: ['Error'], businessRules: [], semanticRubric: ['用户完成任务'], deterministicAssertions: [], inconclusiveWhen: ['证据不足'] },
    coverageDimensions: [{ dimension: 'capability', value: 'cap-create' }, { dimension: 'persona', value: 'user-new' }, { dimension: 'input_quality', value: 'complete' }, { dimension: 'system_state', value: 'normal' }, { dimension: 'journey_stage', value: 'core_task' }, { dimension: 'risk', value: 'critical' }, { dimension: 'interaction_pattern', value: 'normal' }], riskLevel: 'P1', generationReason: 'fixture', version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 7, lastExecutedAt: null }, regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: now, updatedAt: now,
  };
}

function passResult(): EvalCaseResult {
  return { runId: 'run-pass', caseId: baseline().caseId, verdict: 'pass', failureSource: null, severity: null, deterministic: { checks: [], hardFailure: false, severity: null, evidenceRefs: ['shot.png'] }, semantic: { verdict: 'pass', taskCompletion: 'complete', summary: '完成', whatWorked: ['结果可见'], whatFailed: [], whyItMatters: [], confirmedFacts: ['结果可见'], hypotheses: [], unknowns: [], evidenceRefs: ['shot.png'], confidence: 1 }, evidencePacketPath: 'runs/run-pass/evidence-packet.json', createdAt: now };
}

describe('PASS evolution and Challenge generation', () => {
  it('turns uncovered target values into explicit coverage gaps', () => {
    const matrix = analyzeCoverage({ model: model(), cases: [baseline()], generatedAt: now });
    expect(matrix.coverageRatio).toBeLessThan(1);
    expect(matrix.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: 'persona', missingValue: 'user-skilled' }),
      expect.objectContaining({ dimension: 'input_quality', missingValue: 'boundary' }),
      expect.objectContaining({ dimension: 'journey_stage', missingValue: 'backtrack' }),
    ]));
  });

  it('generates boundary, journey and persona candidates without making them permanent', () => {
    const analysis = analyzePassingCase({ evalCase: baseline(), result: passResult(), model: model(), existingCases: [baseline()], generatedAt: now });
    expect(analysis.confirmedConditions).toEqual(baseline().coverageDimensions);
    expect(analysis.challengeCandidates).toHaveLength(3);
    expect(analysis.challengeCandidates.every((item) => item.setType === 'challenge' && item.status === 'candidate')).toBe(true);
    expect(analysis.challengeCandidates.map((item) => item.caseId)).toEqual(expect.arrayContaining([expect.stringContaining('boundary'), expect.stringContaining('journey'), expect.stringContaining('persona')]));
    expect(analysis.challengeCandidates.every((item) => item.origin.type === 'generated_from_coverage_gap')).toBe(true);
  });

  it('does not persist candidates until an explicit save occurs', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-challenge-'));
    await saveEvalCase(outputDir, baseline());
    const analysis = analyzePassingCase({ evalCase: baseline(), result: passResult(), model: model(), existingCases: [baseline()], generatedAt: now });
    expect((await loadEvalSetManifest(outputDir)).cases).toHaveLength(1);
    await saveEvalCase(outputDir, analysis.challengeCandidates[0]!);
    expect((await loadEvalSetManifest(outputDir)).cases).toHaveLength(2);
  });

  it('updates case statistics only with a matching result', () => {
    expect(recordCaseResult(baseline(), passResult()).stats).toMatchObject({ passCount: 1, latestResult: 'pass', latestRunId: 'run-pass' });
    expect(() => recordCaseResult(baseline(), { ...passResult(), caseId: 'other' })).toThrow(/其他案例/);
  });
});
