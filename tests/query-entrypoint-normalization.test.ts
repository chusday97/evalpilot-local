import { describe, expect, it } from 'vitest';
import { MockAiProvider } from '../src/ai/mock-provider.js';
import { understandProductTasks } from '../src/product-model/product-understanding-agent.js';
import { compileExecutableScenario } from '../src/scenario/scenario-compiler.js';

const now = '2026-08-13T00:00:00.000Z';
const evidence = { claim: 'fixture route is verified', sourceType: 'repository' as const, source: 'fixture.ts', status: 'verified' as const };

const provider = new MockAiProvider((request) => {
  if (request.task !== 'product_understanding') return {};
  return {
    capabilities: [{
      capabilityId: 'cap-aquarium',
      name: 'Aquarium',
      description: 'Create an aquarium from a query-driven entry point.',
      routes: ['/aquarium'],
      entryPoints: ['/aquarium?action=create'],
      userGoals: ['Create an aquarium'],
      importance: 'critical',
      evidenceStatus: 'verified',
      evidenceRefs: ['route-1'],
      needsHumanReview: false,
    }],
    userTasks: [{
      taskId: 'task-create-aquarium',
      capabilityId: 'cap-aquarium',
      name: 'Create aquarium',
      goal: 'Create an aquarium',
      preconditions: [],
      successConditions: ['Saved'],
      successSignals: [{
        signalId: 'signal-saved',
        kind: 'text_visible',
        target: 'Saved',
        description: 'Saved',
        evidenceStatus: 'verified',
        evidenceRefs: ['route-1'],
        needsHumanReview: false,
      }],
      businessRuleIds: [],
      evidenceStatus: 'verified',
      evidenceRefs: ['route-1'],
      needsHumanReview: false,
    }],
    objectLifecycles: [],
    crossPageJourneys: [],
    businessRules: [],
    unknowns: [],
  };
});

describe('query entry-point normalization', () => {
  it('validates entry points by pathname while preserving query parameters for execution', async () => {
    const background = {
      projectName: 'Query Entry Point Fixture',
      projectType: 'Web App',
      currentStatus: 'verified',
      problem: 'Create an aquarium',
      targetUsers: ['Aquarium keeper'],
      userTasks: ['Create an aquarium'],
      capabilities: [{ id: 'cap-aquarium', name: 'Aquarium', description: 'Manage an aquarium', status: 'verified', routes: ['/aquarium'], evidence: [evidence], dependencies: [], risks: [] }],
      corePages: ['/aquarium'],
      primaryJourneys: ['Create an aquarium'],
      aiResponsibilities: [],
      ruleResponsibilities: [],
      externalDependencies: [],
      highRiskOperations: [],
      knownLimitations: [],
      assumptions: [],
      unknowns: [],
      evidence: [evidence],
      fieldStatuses: { targetUsers: 'verified', ruleResponsibilities: 'verified' },
      fieldEvidence: { targetUsers: [evidence], ruleResponsibilities: [evidence] },
      generatedAt: now,
    } as any;
    const blueprint = {
      projectName: 'Query Entry Point Fixture',
      capabilities: [{ id: 'cap-aquarium', name: 'Aquarium', importance: 'critical', userGoals: ['Create an aquarium'], entryPoints: ['/aquarium?action=create'], successConditions: ['Saved'], hardConstraints: [], failureConditions: [], dependencies: [], requiredPersonas: [], requiredInputQualities: [], requiredSystemStates: [], graders: ['deterministic'], approvalStatus: 'approved' }],
      generatedAt: now,
    } as any;
    const routes = { routes: [{ path: '/aquarium', source: 'fixture.ts', status: 'verified' }], sourceFiles: ['fixture.ts'], scannedAt: now } as any;

    const understood = await understandProductTasks({ projectId: 'project-query-entry', background, blueprint, routes, pages: [], documents: { documents: [], claims: [], scannedAt: now }, provider, generatedAt: now });

    expect(understood.mode).toBe('ai');
    expect(understood.model.capabilities[0]?.entryPoints).toEqual(['/aquarium?action=create']);
    expect(understood.warnings).not.toContain('能力 cap-aquarium 的未知路由或入口已过滤。');

    const scenario = compileExecutableScenario({
      evalCase: {
        caseId: 'case-create-aquarium',
        projectId: 'project-query-entry',
        capabilityId: 'cap-aquarium',
        taskId: 'task-create-aquarium',
        goal: 'Create an aquarium',
        knownInformation: {},
        preconditions: [],
      } as any,
      productModel: understood.model,
      targetUrl: 'http://127.0.0.1:3000/',
      generatedAt: now,
    });

    expect(scenario.startingUrl).toBe('http://127.0.0.1:3000/aquarium?action=create');
  });
});
