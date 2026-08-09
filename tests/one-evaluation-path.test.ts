import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EvalCase, ProductModel } from '../types.js';
import { selectEvaluationCases } from '../src/evaluation/evaluation-selector.js';
import { evaluationSourceFingerprint } from '../src/evaluation/evaluation-foundation.js';

const now = '2026-08-09T07:00:00.000Z';
const model = { capabilities: [
  { capabilityId: 'cap-critical', name: 'Critical', importance: 'critical' },
  { capabilityId: 'cap-high', name: 'High', importance: 'high' },
  { capabilityId: 'cap-medium', name: 'Medium', importance: 'medium' },
] } as ProductModel;

function evalCase(caseId: string, setType: EvalCase['setType'], capabilityId: string, riskLevel: EvalCase['riskLevel']): EvalCase {
  return { caseId, projectId: 'project-demo', setType, status: 'stable', origin: setType === 'regression' ? { type: 'badcase', issueId: `issue-${caseId}`, badcaseId: `badcase-${caseId}`, firstFailedRunId: `run-${caseId}` } : { type: 'human', note: 'fixture' }, capabilityId, taskId: null, title: caseId, hypothesis: 'task works', persona: { personaId: 'user', name: 'User', behaviorPolicy: ['safe'] }, goal: 'complete task', knownInformation: {}, preconditions: [], oracle: { expectedOutcome: ['done'], mustObserve: [], mustNotObserve: [], businessRules: [], semanticRubric: ['done'], deterministicAssertions: [], inconclusiveWhen: ['missing evidence'] }, coverageDimensions: [{ dimension: 'capability', value: capabilityId }], riskLevel, generationReason: 'fixture', version: 1, stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 1, lastExecutedAt: null }, regressionMetadata: setType === 'regression' ? { badcaseId: `badcase-${caseId}`, issueId: `issue-${caseId}`, firstFailedAt: now, fixedAt: now, originalFailure: 'failed', sourceRunId: `run-${caseId}`, fixTaskId: null } : null, retirementReason: null, needsHumanReview: false, createdAt: now, updatedAt: now };
}

const cases = [
  evalCase('baseline-critical', 'baseline', 'cap-critical', 'P1'),
  evalCase('baseline-high', 'baseline', 'cap-high', 'P2'),
  evalCase('baseline-medium', 'baseline', 'cap-medium', 'P3'),
  evalCase('regression-critical', 'regression', 'cap-critical', 'P1'),
  evalCase('challenge-critical', 'challenge', 'cap-critical', 'P2'),
  evalCase('explore-medium', 'exploratory', 'cap-medium', 'P3'),
];

describe('one evaluation path', () => {
  it('keeps quick to one critical baseline plus relevant regression', () => {
    expect(selectEvaluationCases({ model, cases, depth: 'quick', capabilityIds: [] }).cases.map((item) => item.caseId)).toEqual(['regression-critical', 'baseline-critical']);
  });

  it('uses critical/high defaults for core and filters every set type for full', () => {
    const core = selectEvaluationCases({ model, cases, depth: 'core', capabilityIds: [] });
    expect(core.cases.map((item) => item.caseId)).toEqual(['regression-critical', 'baseline-critical', 'baseline-high', 'challenge-critical']);
    const full = selectEvaluationCases({ model, cases, depth: 'full', capabilityIds: ['cap-medium'] });
    expect(full.cases.map((item) => item.caseId)).toEqual(['baseline-medium', 'explore-medium']);
  });

  it('keeps the normal evaluation manager free of the Legacy Explorer runtime', async () => {
    const source = await readFile(new URL('../src/dashboard/evaluation-manager.ts', import.meta.url), 'utf8');
    const orchestrator = await readFile(new URL('../src/evaluation/evaluation-orchestrator.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('runExploratoryScenario');
    expect(source).toContain('runEvaluationOrchestrator');
    expect(orchestrator).toContain('results, evidencePackets: packets');
    expect(orchestrator).not.toContain('loadLatestCoverageMatrix');
  });

  it('changes the foundation fingerprint only when source evidence changes', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-foundation-fingerprint-'));
    await mkdir(resolve(outputDir, 'evidence'));
    await Promise.all([
      writeFile(resolve(outputDir, 'project-background.yaml'), 'projectId: demo\n'),
      writeFile(resolve(outputDir, 'eval-blueprint.yaml'), 'projectId: demo\n'),
      writeFile(resolve(outputDir, 'evidence/routes.json'), '{}'),
      writeFile(resolve(outputDir, 'evidence/pages.json'), '[]'),
      writeFile(resolve(outputDir, 'evidence/documents.json'), '{}'),
    ]);
    const before = await evaluationSourceFingerprint(outputDir);
    expect(await evaluationSourceFingerprint(outputDir)).toBe(before);
    await writeFile(resolve(outputDir, 'evidence/pages.json'), '[{"url":"/new"}]');
    expect(await evaluationSourceFingerprint(outputDir)).not.toBe(before);
  });
});
