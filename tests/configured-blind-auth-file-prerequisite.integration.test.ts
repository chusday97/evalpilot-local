import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EvalCase, ProductModel } from '../types.js';
import { saveEvalCase } from '../src/eval-set/eval-set-store.js';
import { saveProductModel } from '../src/product-model/product-model-store.js';
import { registerProject } from '../src/projects/project-service.js';
import { planConfiguredBlindExperience, runConfiguredBlindExperience } from '../src/ux-evaluation/configured-blind-experience-runner.js';

const now = '2026-08-16T02:30:00.000Z';
const targetUrl = 'http://127.0.0.1:43123';

afterEach(() => {
  delete process.env.EVALPILOT_DATA_DIR;
  delete process.env.EVALPILOT_AUTH_STATE;
  delete process.env.EVALPILOT_OPENAI_API_KEY;
});

function model(projectId: string, preconditions: string[]): ProductModel {
  return {
    projectId,
    version: 1,
    generatedAt: now,
    productName: 'Configured Blind prerequisite fixture',
    productType: 'Web',
    targetUsers: [{ userTypeId: 'user-test', name: 'Test user', description: 'Fixture user', goals: ['Complete task'], evidenceStatus: 'verified', evidence: [], needsHumanReview: false }],
    capabilities: [{
      capabilityId: 'cap-target', name: 'Target task', description: 'Fixture capability', routes: ['/'], entryPoints: ['/'], userGoals: ['Complete task'], supportedTasks: ['task-target'], importance: 'critical', evidenceStatus: 'verified', evidence: [], needsHumanReview: false,
    }],
    userTasks: [{
      taskId: 'task-target', capabilityId: 'cap-target', name: 'Target task', goal: 'Complete task', preconditions,
      successConditions: ['Done'], successSignals: [{ signalId: 'done', kind: 'text_visible', target: 'Done', description: 'Done is visible', evidenceStatus: 'verified', evidence: [], needsHumanReview: false }],
      businessRuleIds: [], evidenceStatus: 'verified', evidence: [], needsHumanReview: false,
    }],
    objectLifecycles: [], crossPageJourneys: [], businessRules: [], knownRisks: [], unknowns: [], evidence: [],
  };
}

function targetCase(projectId: string, preconditions: string[]): EvalCase {
  return {
    caseId: 'target-case', projectId, setType: 'baseline', status: 'stable', origin: { type: 'human', note: 'configured prerequisite fixture' },
    capabilityId: 'cap-target', taskId: 'task-target', title: 'Target task', hypothesis: 'Prerequisite planning is safe',
    persona: { personaId: 'user-test', name: 'Test user', knowledgeLevel: 'low', patienceTurns: 4, retryTolerance: 1, privacySensitivity: 'high', behaviorPolicy: ['只依据可见界面行动'], exitConditions: ['前置状态不安全时退出'] },
    goal: 'Complete task', knownInformation: {}, preconditions,
    oracle: { expectedOutcome: ['Done'], mustObserve: ['Done'], mustNotObserve: ['Fatal error'], businessRules: [], semanticRubric: ['Goal completion is visible'], deterministicAssertions: [], inconclusiveWhen: ['Evidence is insufficient'] },
    coverageDimensions: [{ dimension: 'capability', value: 'cap-target' }], riskLevel: 'P1', generationReason: 'integration fixture', version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 1, lastExecutedAt: null }, regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: now, updatedAt: now,
  };
}

async function fixture(preconditions: string[]) {
  const cwd = await mkdtemp(resolve(tmpdir(), 'evalpilot-blind-auth-file-'));
  process.env.EVALPILOT_DATA_DIR = resolve(cwd, '.evalpilot-data');
  const projectRoot = resolve(cwd, 'target');
  await mkdir(projectRoot, { recursive: true });
  await writeFile(resolve(projectRoot, 'package.json'), JSON.stringify({ name: 'configured-blind-auth-file-fixture' }));
  const project = await registerProject(cwd, { projectRoot, targetUrl });
  await saveProductModel(project.outputDir, model(project.projectId, preconditions));
  const evalCase = targetCase(project.projectId, preconditions);
  await saveEvalCase(project.outputDir, evalCase);
  return { cwd, project, evalCase };
}

describe('configured Blind Auth/File prerequisite integration', () => {
  it('blocks missing Auth before provider/browser execution', async () => {
    const { cwd, project, evalCase } = await fixture(['User is logged in']);
    const preflight = await planConfiguredBlindExperience(cwd, { projectId: project.projectId, caseId: evalCase.caseId });

    expect(preflight).toEqual(expect.objectContaining({ status: 'blocked', canRun: false }));
    expect(preflight.prerequisite.unresolvedBlockers.some((blocker) => blocker.type === 'needs_auth')).toBe(true);
    expect(preflight.reasons.join(' ')).toContain('缺少显式本地 Auth Fixture');
    await expect(runConfiguredBlindExperience(cwd, { projectId: project.projectId, caseId: evalCase.caseId }))
      .rejects.toMatchObject({ code: 'BLIND_EXPERIENCE_PREREQUISITE_BLOCKED' });
  });

  it('accepts a scoped local Auth fixture while keeping secret values out of preflight', async () => {
    const { cwd, project, evalCase } = await fixture(['User is logged in']);
    const authPath = resolve(cwd, 'auth-state.json');
    await writeFile(authPath, JSON.stringify({
      cookies: [{ name: 'session', value: 'session-secret-value', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }],
      origins: [],
    }));
    if (process.platform !== 'win32') await chmod(authPath, 0o600);
    process.env.EVALPILOT_AUTH_STATE = authPath;

    const preflight = await planConfiguredBlindExperience(cwd, { projectId: project.projectId, caseId: evalCase.caseId });
    expect(preflight).toEqual(expect.objectContaining({ status: 'ready', canRun: true }));
    expect(preflight.prerequisite.executionOrder).toEqual(['auth', 'target']);
    expect(preflight.prerequisite.auth).toEqual(expect.objectContaining({ source: 'runtime_local_storage_state', targetOrigin: targetUrl, cookieCount: 1, originCount: 0 }));
    expect(JSON.stringify(preflight)).not.toContain('session-secret-value');
    expect(JSON.stringify(preflight)).not.toContain('"session"');
  });

  it('plans a fixed synthetic CSV fixture for an explicit loopback test-file prerequisite', async () => {
    const { cwd, project, evalCase } = await fixture(['A test CSV file is ready']);
    const preflight = await planConfiguredBlindExperience(cwd, { projectId: project.projectId, caseId: evalCase.caseId });

    expect(preflight).toEqual(expect.objectContaining({ status: 'ready', canRun: true }));
    expect(preflight.prerequisite.executionOrder).toEqual(['file_fixture', 'target']);
    expect(preflight.prerequisite.fileFixtures).toEqual([
      expect.objectContaining({ kind: 'csv', filename: 'evalpilot-fixture.csv', mimeType: 'text/csv' }),
    ]);
  });

  it('blocks semantic/complex PDF prerequisites instead of fabricating a file', async () => {
    const { cwd, project, evalCase } = await fixture(['A test PDF file is ready']);
    const preflight = await planConfiguredBlindExperience(cwd, { projectId: project.projectId, caseId: evalCase.caseId });

    expect(preflight).toEqual(expect.objectContaining({ status: 'blocked', canRun: false }));
    expect(preflight.prerequisite.fileFixtures).toEqual([]);
    expect(preflight.prerequisite.unresolvedBlockers.some((blocker) => blocker.type === 'needs_test_data')).toBe(true);
    expect(preflight.reasons.join(' ')).toContain('该文件类型需要有语义内容或复杂二进制结构');
    await expect(runConfiguredBlindExperience(cwd, { projectId: project.projectId, caseId: evalCase.caseId }))
      .rejects.toMatchObject({ code: 'BLIND_EXPERIENCE_PREREQUISITE_BLOCKED' });
  });
});
