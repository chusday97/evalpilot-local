import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EvalCase, ProductModel } from '../types.js';
import { registerProject } from '../src/projects/project-service.js';
import { saveProductModel } from '../src/product-model/product-model-store.js';
import { saveEvalCase } from '../src/eval-set/eval-set-store.js';
import { planConfiguredBlindExperience, runConfiguredBlindExperience } from '../src/ux-evaluation/configured-blind-experience-runner.js';

const now = '2026-08-16T01:45:00.000Z';

afterEach(() => {
  delete process.env.EVALPILOT_DATA_DIR;
  delete process.env.EVALPILOT_OPENAI_API_KEY;
});

function model(projectId: string): ProductModel {
  return {
    projectId,
    version: 1,
    generatedAt: now,
    productName: 'Prerequisite blocker fixture',
    productType: 'Web',
    targetUsers: [{
      userTypeId: 'user-new',
      name: 'New user',
      description: 'Fixture user',
      goals: ['Create and record an item'],
      evidenceStatus: 'verified',
      evidence: [],
      needsHumanReview: false,
    }],
    capabilities: [
      {
        capabilityId: 'cap-create',
        name: 'Create item',
        description: 'Creates local fixture state',
        routes: ['/'],
        entryPoints: ['/'],
        userGoals: ['Create an item'],
        supportedTasks: ['task-create'],
        importance: 'critical',
        evidenceStatus: 'verified',
        evidence: [],
        needsHumanReview: false,
      },
      {
        capabilityId: 'cap-record',
        name: 'Record detail',
        description: 'Records detail on an existing item',
        routes: ['/'],
        entryPoints: ['/'],
        userGoals: ['Record a detail'],
        supportedTasks: ['task-record'],
        importance: 'critical',
        evidenceStatus: 'verified',
        evidence: [],
        needsHumanReview: false,
      },
    ],
    userTasks: [
      {
        taskId: 'task-create',
        capabilityId: 'cap-create',
        name: 'Create item',
        goal: 'Create an item',
        preconditions: ['App is open'],
        successConditions: ['Created'],
        successSignals: [{
          signalId: 'create-visible',
          kind: 'text_visible',
          target: 'Created',
          description: 'Created state is visible',
          evidenceStatus: 'verified',
          evidence: [],
          needsHumanReview: false,
        }],
        businessRuleIds: [],
        evidenceStatus: 'verified',
        evidence: [],
        needsHumanReview: false,
      },
      {
        taskId: 'task-record',
        capabilityId: 'cap-record',
        name: 'Record detail',
        goal: 'Record a detail on the existing item',
        preconditions: ['An existing record has already been created'],
        successConditions: ['Recorded'],
        successSignals: [{
          signalId: 'record-visible',
          kind: 'text_visible',
          target: 'Recorded',
          description: 'Recorded state is visible',
          evidenceStatus: 'verified',
          evidence: [],
          needsHumanReview: false,
        }],
        businessRuleIds: [],
        evidenceStatus: 'verified',
        evidence: [],
        needsHumanReview: false,
      },
    ],
    objectLifecycles: [],
    crossPageJourneys: [{
      journeyId: 'journey-create-record',
      name: 'Create then record',
      taskIds: ['task-create', 'task-record'],
      routes: ['/'],
      successConditions: ['Recorded'],
      evidenceStatus: 'verified',
      evidence: [],
      needsHumanReview: false,
    }],
    businessRules: [],
    knownRisks: [],
    unknowns: [],
    evidence: [],
  };
}

function evalCase(projectId: string, caseId: string, taskId: 'task-create' | 'task-record', knownInformation: Record<string, unknown>, setType: EvalCase['setType'] = 'baseline'): EvalCase {
  const create = taskId === 'task-create';
  return {
    caseId,
    projectId,
    setType,
    status: 'stable',
    origin: { type: 'human', note: 'configured Blind prerequisite integration fixture' },
    capabilityId: create ? 'cap-create' : 'cap-record',
    taskId,
    title: create ? 'Create item baseline' : 'Record detail target',
    hypothesis: create ? 'Creates prerequisite state' : 'Target requires prerequisite state',
    persona: {
      personaId: 'user-new',
      name: 'New user',
      knowledgeLevel: 'low',
      patienceTurns: 4,
      retryTolerance: 1,
      privacySensitivity: 'medium',
      behaviorPolicy: ['只依据可见界面行动'],
      exitConditions: ['没有安全路径时退出'],
    },
    goal: create ? 'Create an item' : 'Record a detail on the existing item',
    knownInformation,
    preconditions: create ? ['App is open'] : ['An existing record has already been created'],
    oracle: {
      expectedOutcome: [create ? 'Created' : 'Recorded'],
      mustObserve: [create ? 'Created' : 'Recorded'],
      mustNotObserve: [],
      businessRules: [],
      semanticRubric: ['Goal completion is visible'],
      deterministicAssertions: [],
      inconclusiveWhen: ['Visible evidence is insufficient'],
    },
    coverageDimensions: [{ dimension: 'capability', value: create ? 'cap-create' : 'cap-record' }],
    riskLevel: 'P1',
    generationReason: 'integration fixture',
    version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 1, lastExecutedAt: null },
    regressionMetadata: null,
    retirementReason: null,
    needsHumanReview: false,
    createdAt: now,
    updatedAt: now,
  };
}

async function fixture(setupBaselines: Array<Record<string, unknown>>) {
  const cwd = await mkdtemp(resolve(tmpdir(), 'evalpilot-blind-prerequisite-blocker-'));
  process.env.EVALPILOT_DATA_DIR = resolve(cwd, '.evalpilot-data');
  const target = resolve(cwd, 'target');
  await mkdir(target, { recursive: true });
  await writeFile(resolve(target, 'package.json'), JSON.stringify({ name: 'blind-prerequisite-blocker-fixture' }));
  const project = await registerProject(cwd, { projectRoot: target, targetUrl: 'http://127.0.0.1:43123' });
  await saveProductModel(project.outputDir, model(project.projectId));
  for (const [index, knownInformation] of setupBaselines.entries()) {
    await saveEvalCase(project.outputDir, evalCase(project.projectId, `baseline-create-${index + 1}`, 'task-create', knownInformation));
  }
  const targetCase = evalCase(project.projectId, 'target-record', 'task-record', { detail: 'fixture detail' });
  await saveEvalCase(project.outputDir, targetCase);
  return { cwd, project, targetCase };
}

describe('configured Blind prerequisite blocker integration', () => {
  it('blocks before provider/browser when required Setup has no reusable stable baseline', async () => {
    const { cwd, project, targetCase } = await fixture([]);
    const preflight = await planConfiguredBlindExperience(cwd, { projectId: project.projectId, caseId: targetCase.caseId });

    expect(preflight).toEqual(expect.objectContaining({ status: 'blocked', canRun: false }));
    expect(preflight.prerequisite.executionOrder).toEqual(['setup', 'target']);
    expect(preflight.setupKnowledge).toEqual([
      expect.objectContaining({ setupTaskId: 'task-create', sourceCaseId: null, candidateCaseIds: [], equivalence: 'missing', status: 'missing_baseline' }),
    ]);
    await expect(runConfiguredBlindExperience(cwd, { projectId: project.projectId, caseId: targetCase.caseId }))
      .rejects.toMatchObject({ code: 'BLIND_EXPERIENCE_PREREQUISITE_BLOCKED' });
  });

  it('allows exact-equivalent duplicate stable baselines and chooses deterministically', async () => {
    const { cwd, project, targetCase } = await fixture([
      { itemType: 'freshwater', size: { width: 30, length: 60 } },
      { size: { length: 60, width: 30 }, itemType: 'freshwater' },
    ]);
    const preflight = await planConfiguredBlindExperience(cwd, { projectId: project.projectId, caseId: targetCase.caseId });

    expect(preflight).toEqual(expect.objectContaining({ status: 'ready', canRun: true }));
    expect(preflight.setupKnowledge).toEqual([
      expect.objectContaining({
        setupTaskId: 'task-create',
        sourceCaseId: 'baseline-create-1',
        candidateCaseIds: ['baseline-create-1', 'baseline-create-2'],
        equivalence: 'exact_signature_match',
        status: 'ready',
      }),
    ]);
    expect(preflight.setupKnowledge[0]?.setupStateFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(new Set(preflight.setupKnowledge[0]?.candidateStateFingerprints.map((item) => item.fingerprint)).size).toBe(1);
  });

  it('blocks before provider/browser when multiple stable baselines cannot prove setup-state equivalence', async () => {
    const { cwd, project, targetCase } = await fixture([
      { itemType: 'freshwater', size: 'small' },
      { itemType: 'saltwater', size: 'small' },
    ]);
    const preflight = await planConfiguredBlindExperience(cwd, { projectId: project.projectId, caseId: targetCase.caseId });

    expect(preflight).toEqual(expect.objectContaining({ status: 'blocked', canRun: false }));
    expect(preflight.setupKnowledge).toEqual([
      expect.objectContaining({
        setupTaskId: 'task-create',
        sourceCaseId: null,
        candidateCaseIds: ['baseline-create-1', 'baseline-create-2'],
        equivalence: 'ambiguous',
        status: 'missing_baseline',
      }),
    ]);
    expect(preflight.reasons.join(' ')).toContain('当前无法证明这些状态等价');
    await expect(runConfiguredBlindExperience(cwd, { projectId: project.projectId, caseId: targetCase.caseId }))
      .rejects.toMatchObject({ code: 'BLIND_EXPERIENCE_PREREQUISITE_BLOCKED' });
  });
});
