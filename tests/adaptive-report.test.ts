import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EvalCase, EvalCaseResult, EvidencePacket } from '../types.js';
import { buildAdaptiveEvaluationReport } from '../src/report/adaptive-report.js';

const now = '2026-08-01T18:00:00.000Z';
const evalCase: EvalCase = { caseId: 'case-report', projectId: 'project-report', setType: 'baseline', status: 'stable', origin: { type: 'human', note: 'report fixture' }, capabilityId: 'cap-result', taskId: null, title: '查看结果', hypothesis: '结果可继续', persona: { personaId: 'user-new', name: '新用户', behaviorPolicy: ['只看可见信息'] }, goal: '查看并继续', knownInformation: {}, preconditions: [], oracle: { expectedOutcome: ['结果可见'], mustObserve: [], mustNotObserve: ['Error'], businessRules: [], semanticRubric: ['任务完成'], deterministicAssertions: [], inconclusiveWhen: ['证据不足'] }, coverageDimensions: [{ dimension: 'capability', value: 'cap-result' }], riskLevel: 'P1', generationReason: 'fixture', version: 1, stats: { passCount: 0, failCount: 1, inconclusiveCount: 0, latestResult: 'fail', latestRunId: 'run-report', uniqueCoverageContribution: 1, lastExecutedAt: now }, regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: now, updatedAt: now };
const result: EvalCaseResult = { runId: 'run-report', caseId: evalCase.caseId, verdict: 'fail', failureSource: 'product', severity: 'P1', deterministic: { checks: [], hardFailure: true, severity: 'P1', evidenceRefs: ['shot.png'] }, semantic: { verdict: 'fail', taskCompletion: 'failed', summary: '结果没有继续入口', whatWorked: ['结果可见'], whatFailed: ['没有继续入口'], whyItMatters: ['用户卡住'], confirmedFacts: ['结果页可见'], hypotheses: [{ hypothesis: '缺少后续信息架构', confidence: 0.7, supportingEvidence: ['shot.png'], contradictingEvidence: [], howToVerify: ['检查结果组件'] }], unknowns: ['真实流失未知'], evidenceRefs: ['shot.png'], confidence: 0.9 }, evidencePacketPath: 'runs/run-report/evidence-packet.json', createdAt: now };
const packet: EvidencePacket = { runId: result.runId, caseId: evalCase.caseId, targetAppCommit: 'abc123', actorModel: 'mock-actor', actorPromptVersion: '1.0.0', startedAt: now, completedAt: now, actions: [{ actionId: 'action-1', type: 'click', timestampMs: 1, page: '/result', target: 'E001', inputField: null, inputLength: null, inputFingerprint: null, outcome: '结果显示但没有继续入口', evidence: ['shot.png'] }], observations: [], stepVerifications: [], screenshots: ['shot.png'], tracePath: null, consoleEvidence: [], networkEvidence: [], finalState: { url: 'http://127.0.0.1/result', visibleTextSummary: '结果已生成' }, versions: { targetAppGitSha: 'abc123', productModelVersion: 1, evalSetVersion: 2, caseVersion: 1, evalPilotVersion: '0.5.0-alpha.1', actorModel: 'mock-actor', judgeModel: 'mock-judge', actorPromptVersion: '1.0.0', judgePromptVersion: '1.0.0', toolSchemaVersion: '1.0.0', timestamp: now } };

describe('adaptive human-readable report', () => {
  it('writes all 16 sections from the same structured report', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-adaptive-report-'));
    const report = await buildAdaptiveEvaluationReport({ outputDir, projectId: 'project-report', selectedCases: [evalCase], results: [result], packets: [packet], coverage: null, generatedAt: now });
    expect(report).toMatchObject({ executiveVerdict: 'needs_attention', failures: [{ caseId: 'case-report' }], versionMetadata: [{ targetAppGitSha: 'abc123', evalSetVersion: 2 }] });
    const markdown = await readFile(resolve(outputDir, 'reports', 'latest-evaluation.md'), 'utf8');
    for (let index = 1; index <= 16; index += 1) expect(markdown).toContain(`## ${index}.`);
    expect(markdown).toContain('结果没有继续入口');
    await expect(readFile(resolve(outputDir, 'reports', 'latest-evaluation.json'), 'utf8')).resolves.toContain('mock-judge');
  });
});
