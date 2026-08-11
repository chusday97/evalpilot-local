import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EvalCase, EvalCaseResult, EvalVerdict, EvidencePacket, ProductModel } from '../types.js';
import { analyzeCoverage } from '../src/eval-set/coverage-analyzer.js';
import { loadLatestCoverageMatrix } from '../src/eval-set/coverage-store.js';

const now = '2026-08-08T12:00:00.000Z';
const evidence = [{ claim: '测试能力已声明', sourceType: 'document' as const, source: 'README.md', status: 'declared' as const }];

function model(capabilityIds = ['cap-create']): ProductModel {
  return {
    projectId: 'project-coverage', version: 1, generatedAt: now, productName: 'Coverage Demo', productType: 'Web',
    targetUsers: [{ userTypeId: 'user-new', name: '新用户', description: '首次用户', goals: ['完成任务'], evidenceStatus: 'declared', evidence, needsHumanReview: false }],
    capabilities: capabilityIds.map((capabilityId) => ({ capabilityId, name: capabilityId, description: '测试能力', routes: ['/'], entryPoints: ['/'], userGoals: ['完成'], supportedTasks: [`task-${capabilityId}`], importance: 'critical' as const, evidenceStatus: 'declared' as const, evidence, needsHumanReview: false })),
    userTasks: capabilityIds.map((capabilityId) => ({ taskId: `task-${capabilityId}`, capabilityId, name: capabilityId, goal: '完成任务', preconditions: [], successConditions: ['结果可见'], evidenceStatus: 'declared' as const, evidence, needsHumanReview: false })),
    businessRules: [], knownRisks: [], unknowns: [], evidence,
  };
}

function evalCase(status: EvalCase['status'] = 'stable', capabilityId = 'cap-create'): EvalCase {
  return {
    caseId: `case-${capabilityId}-${status}`, projectId: 'project-coverage', setType: status === 'candidate' ? 'challenge' : 'baseline', status,
    origin: { type: 'human', note: 'coverage fixture' }, capabilityId, taskId: `task-${capabilityId}`, title: '完成任务', hypothesis: '用户可以完成',
    persona: { personaId: 'user-new', name: '新用户', behaviorPolicy: ['安全操作'] }, goal: '完成任务', knownInformation: {}, preconditions: [],
    oracle: { expectedOutcome: ['结果可见'], mustObserve: [], mustNotObserve: ['Error'], businessRules: [], semanticRubric: ['任务完成'], deterministicAssertions: [], inconclusiveWhen: ['证据不足'] },
    coverageDimensions: [{ dimension: 'capability', value: capabilityId }, { dimension: 'persona', value: 'user-new' }, { dimension: 'input_quality', value: 'complete' }],
    riskLevel: 'P1', generationReason: 'fixture', version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 3, lastExecutedAt: null },
    regressionMetadata: null, retirementReason: status === 'retired' ? 'obsolete' : null, needsHumanReview: false, createdAt: now, updatedAt: now,
  };
}

function result(evalCaseValue: EvalCase, verdict: EvalVerdict): EvalCaseResult {
  return {
    runId: `run-${evalCaseValue.capabilityId}-${verdict}`, caseId: evalCaseValue.caseId, verdict,
    failureSource: verdict === 'pass' ? null : verdict === 'fail' ? 'product' : 'unknown', severity: verdict === 'fail' ? 'P1' : null,
    deterministic: { checks: [], hardFailure: verdict === 'fail', severity: verdict === 'fail' ? 'P1' : null, evidenceRefs: ['shot.png'] },
    semantic: { verdict, taskCompletion: verdict === 'pass' ? 'complete' : verdict === 'fail' ? 'failed' : 'unknown', summary: verdict, whatWorked: [], whatFailed: [], whyItMatters: [], confirmedFacts: [], hypotheses: [], unknowns: [], evidenceRefs: ['shot.png'], confidence: 1 },
    evidencePacketPath: `runs/run-${evalCaseValue.capabilityId}-${verdict}/evidence-packet.json`, createdAt: now,
  };
}

function packet(run: EvalCaseResult): EvidencePacket {
  return {
    runId: run.runId, caseId: run.caseId, targetAppCommit: null, actorModel: 'mock', actorPromptVersion: '1', startedAt: now, completedAt: now,
    actions: [{ actionId: 'agent-action-001', type: 'navigation', timestampMs: 1, page: '/', target: null, inputField: null, inputLength: null, inputFingerprint: null, outcome: '完成', evidence: ['before.png', 'after.png'] }],
    observations: [{ observationId: 'observation-001-before', pageUrl: 'http://127.0.0.1', pagePurpose: 'fixture', visibleStateSummary: '开始', primaryAreas: [], visibleProblems: [], interactableElements: [], formFields: [], evidenceRefs: ['before.png'], confidence: 1 }, { observationId: 'observation-001-after', pageUrl: 'http://127.0.0.1', pagePurpose: 'fixture', visibleStateSummary: '完成', primaryAreas: [], visibleProblems: [], interactableElements: [], formFields: [], evidenceRefs: ['after.png'], confidence: 1 }],
    stepVerifications: [{ verificationId: 'verification-001', expectation: '完成', observed: '完成', status: 'confirmed', evidenceRefs: ['after.png'], confidence: 1 }],
    stepEvidence: [{ stepIndex: 1, beforeObservationId: 'observation-001-before', afterObservationId: 'observation-001-after', beforeScreenshotPath: 'before.png', afterScreenshotPath: 'after.png', decisionId: 'decision-001', verificationId: 'verification-001', actionStatus: 'executed', taskState: null, taskWait: null }],
    screenshots: ['before.png', 'after.png'], tracePath: 'trace.zip', evidenceCompleteness: { complete: true, hasInitialObservation: true, hasFinalObservation: true, hasBeforeAfterScreenshots: true, hasStepVerifications: true, hasTrace: true, missing: [] },
    consoleEvidence: [], networkEvidence: [], finalState: { url: 'http://127.0.0.1', visibleTextSummary: '完成' },
    versions: { targetAppGitSha: null, productModelVersion: 1, evalSetVersion: 1, caseVersion: 1, evalPilotVersion: '0.5.0-alpha.1', actorModel: 'mock', judgeModel: 'mock', actorPromptVersion: '1', judgePromptVersion: '1', toolSchemaVersion: '1', timestamp: now },
  };
}

function capabilityCell(matrix: ReturnType<typeof analyzeCoverage>, capabilityId = 'cap-create') {
  return matrix.cells.find((cell) => cell.capabilityId === capabilityId && cell.dimension === 'capability')!;
}

describe('truthful coverage', () => {
  it('counts an unrun candidate as asset only', () => {
    const matrix = analyzeCoverage({ model: model(), cases: [evalCase('candidate')], generatedAt: now });
    expect(capabilityCell(matrix)).toMatchObject({ assetStatus: 'candidate', executionStatus: 'not_run', verified: false });
    expect(matrix.assetCoverageRatio).toBeGreaterThan(0);
    expect(matrix.executionCoverageRatio).toBe(0);
    expect(matrix.verifiedCoverageRatio).toBe(0);
  });

  it('counts a stable failure as executed but not verified', () => {
    const stable = evalCase(); const failed = result(stable, 'fail');
    const matrix = analyzeCoverage({ model: model(), cases: [stable], results: [failed], evidencePackets: [packet(failed)], generatedAt: now });
    expect(capabilityCell(matrix)).toMatchObject({ assetStatus: 'stable', executionStatus: 'fail', verified: false });
    expect(matrix.gaps).toContainEqual(expect.objectContaining({ kind: 'failed', capabilityId: 'cap-create', dimension: 'capability' }));
  });

  it('keeps an inconclusive run outside verified coverage', () => {
    const stable = evalCase(); const inconclusive = result(stable, 'inconclusive');
    const matrix = analyzeCoverage({ model: model(), cases: [stable], results: [inconclusive], evidencePackets: [packet(inconclusive)], generatedAt: now });
    expect(capabilityCell(matrix)).toMatchObject({ executionStatus: 'inconclusive', verified: false });
    expect(matrix.gaps).toContainEqual(expect.objectContaining({ kind: 'inconclusive' }));
  });

  it('verifies a stable PASS only with a valid evidence packet', () => {
    const stable = evalCase(); const passed = result(stable, 'pass');
    const withoutEvidence = analyzeCoverage({ model: model(), cases: [stable], results: [passed], generatedAt: now });
    const withEvidence = analyzeCoverage({ model: model(), cases: [stable], results: [passed], evidencePackets: [packet(passed)], generatedAt: now });
    expect(capabilityCell(withoutEvidence)).toMatchObject({ executionStatus: 'pass', verified: false });
    expect(capabilityCell(withEvidence)).toMatchObject({ executionStatus: 'pass', verified: true });
    expect(withEvidence.coverageRatio).toBe(withEvidence.verifiedCoverageRatio);
  });

  it('does not count retired cases', () => {
    const matrix = analyzeCoverage({ model: model(), cases: [evalCase('retired')], generatedAt: now });
    expect(capabilityCell(matrix)).toMatchObject({ assetStatus: 'missing', executionStatus: 'not_run', verified: false, caseIds: [] });
  });

  it('does not let one capability verify another capability', () => {
    const first = evalCase('stable', 'cap-create'); const passed = result(first, 'pass');
    const matrix = analyzeCoverage({ model: model(['cap-create', 'cap-pay']), cases: [first], results: [passed], evidencePackets: [packet(passed)], generatedAt: now });
    expect(capabilityCell(matrix, 'cap-create').verified).toBe(true);
    expect(capabilityCell(matrix, 'cap-pay')).toMatchObject({ assetStatus: 'missing', verified: false });
  });

  it('reads legacy coverage without promoting it to verified', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-legacy-coverage-'));
    await mkdir(resolve(outputDir, 'coverage'), { recursive: true });
    await writeFile(resolve(outputDir, 'coverage', 'latest.json'), JSON.stringify({ projectId: 'project-coverage', generatedAt: now, dimensions: [{ dimension: 'capability', targetValues: ['cap-create'], coveredValues: ['cap-create'], missingValues: [], coverageRatio: 1 }], gaps: [], totalTargetCells: 1, coveredCells: 1, coverageRatio: 1 }));
    const legacy = await loadLatestCoverageMatrix(outputDir);
    expect(legacy).toMatchObject({ assetCoverageRatio: 1, executionCoverageRatio: 0, verifiedCoverageRatio: 0, coverageRatio: 0, cells: [] });
  });
});
