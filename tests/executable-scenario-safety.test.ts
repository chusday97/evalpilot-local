import { describe, expect, it } from 'vitest';
import type { EvalCase, ProductModel } from '../types.js';
import { compileExecutableScenario } from '../src/scenario/scenario-compiler.js';

const now = '2026-08-12T05:00:00.000Z';
const productModel: ProductModel = {
  projectId: 'project-safety',
  version: 1,
  generatedAt: now,
  productName: 'Safety fixture',
  productType: 'Web App',
  targetUsers: [],
  capabilities: [{ capabilityId: 'cap-main', name: 'Main', description: 'Main', routes: ['/'], entryPoints: ['/'], userGoals: ['Use app'], supportedTasks: ['task-main'], importance: 'critical', evidenceStatus: 'verified', evidence: [], needsHumanReview: false }],
  userTasks: [{ taskId: 'task-main', capabilityId: 'cap-main', name: 'Main', goal: 'Use app', preconditions: [], successConditions: ['Done'], evidenceStatus: 'verified', evidence: [], needsHumanReview: false }],
  businessRules: [], knownRisks: [], unknowns: [], evidence: [],
};

function caseWith(preconditions: string[], knownInformation: Record<string, unknown> = {}): EvalCase {
  return {
    caseId: 'case-main', projectId: 'project-safety', setType: 'baseline', status: 'stable', origin: { type: 'human', note: 'safety ordering' }, capabilityId: 'cap-main', taskId: 'task-main', title: 'Main', hypothesis: 'works', persona: { personaId: 'user', name: 'User', behaviorPolicy: ['safe'] }, goal: 'Use app', knownInformation, preconditions,
    oracle: { expectedOutcome: ['Done'], mustObserve: [], mustNotObserve: [], businessRules: [], semanticRubric: [], deterministicAssertions: [], inconclusiveWhen: [] }, coverageDimensions: [], riskLevel: 'P1', generationReason: 'test', version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 0, lastExecutedAt: null }, regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: now, updatedAt: now,
  };
}

describe('Scenario preflight safety ordering', () => {
  it('does not treat account information as proof of an authenticated browser session', () => {
    const scenario = compileExecutableScenario({ evalCase: caseWith(['logged in with test_account'], { test_account: 'demo@example.invalid' }), productModel, targetUrl: 'http://127.0.0.1:3000', generatedAt: now });
    expect(scenario.readiness).toBe('needs_auth');
  });

  it('does not mistake a running project prerequisite for an existing-object setup dependency', () => {
    const scenario = compileExecutableScenario({ evalCase: caseWith(['project is running']), productModel, targetUrl: 'http://127.0.0.1:3000', generatedAt: now });
    expect(scenario.readiness).toBe('ready');
  });
});
