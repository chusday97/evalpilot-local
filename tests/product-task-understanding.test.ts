import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DocumentEvidence, EvalBlueprint, PageEvidence, ProjectBackground, RouteEvidence } from '../types.js';
import { MockAiProvider } from '../src/ai/mock-provider.js';
import { generateBaselineCases, generateBaselineCasesWithOracleBuilder } from '../src/eval-set/eval-set-generator.js';
import { buildProductModel } from '../src/product-model/product-model-builder.js';
import { understandProductTasks } from '../src/product-model/product-understanding-agent.js';
import { generateAdaptiveFoundation } from '../src/dashboard/adaptive-dashboard-data.js';
import { loadProductModel } from '../src/product-model/product-model-store.js';
import { writeJsonAtomic, writeYamlAtomic } from '../src/utils/file-system.js';

const now = '2026-08-09T02:00:00.000Z';
const evidence = { claim: '测试夹具提供可见任务证据', sourceType: 'repository' as const, source: 'fixture.ts', status: 'verified' as const };
type FixtureKind = 'form' | 'crud' | 'ai';

function page(url: string, title: string, headings: string[], buttons: string[], inputs: string[] = [], forms = 0): PageEvidence {
  return { url, title, visibleText: `SECRET_SHOULD_NOT_LEAVE ${headings.join(' ')} ${buttons.join(' ')}`, links: [], buttons: buttons.map((text) => ({ text, role: 'button', risk: 'safe' as const })), inputs: inputs.map((name) => ({ text: name, name, type: 'text', risk: 'safe' as const })), forms, dialogs: 0, accessibility: { lang: 'en', headings, imageAltMissing: 0 }, screenshot: null, consoleErrors: [], networkErrors: [], exploredAt: now };
}

function fixture(kind: FixtureKind): { projectId: string; background: ProjectBackground; blueprint: EvalBlueprint; routes: RouteEvidence; pages: PageEvidence[]; documents: DocumentEvidence } {
  const config = kind === 'form'
    ? { name: 'Form Fixture', type: 'Web form', cap: 'cap-create', capName: 'Create project', goal: 'Create a project', routes: ['/'], success: ['Created', 'Safe demo'], constraints: ['Do not publish automatically'], pages: [page('http://fixture.test/', 'Create', ['Create project'], ['Create'], ['project_name'], 1)] }
    : kind === 'crud'
      ? { name: 'CRUD Fixture', type: 'Multi-page CRUD', cap: 'cap-item', capName: 'Manage records', goal: 'Manage a record', routes: ['/items', '/items/new', '/items/:id/edit'], success: ['Record details remain visible'], constraints: ['Save changes before leaving'], pages: [page('http://fixture.test/items', 'Items', ['Records'], ['View']), page('http://fixture.test/items/new', 'New item', ['Create record'], ['Create'], ['name'], 1), page('http://fixture.test/items/1/edit', 'Edit item', ['Edit record'], ['Save'], ['name'], 1)] }
      : { name: 'AI Fixture', type: 'AI generation app', cap: 'cap-generate', capName: 'Generate answer', goal: 'Generate an answer from a prompt', routes: ['/generate'], success: ['Generated answer', 'Source links'], constraints: ['Answers should cite reliable sources'], pages: [page('http://fixture.test/generate', 'Generator', ['Generate answer'], ['Generate'], ['prompt'], 1)] };
  const fieldNames = ['projectName', 'projectType', 'currentStatus', 'problem', 'targetUsers', 'userTasks', 'capabilities', 'corePages', 'primaryJourneys', 'aiResponsibilities', 'ruleResponsibilities', 'externalDependencies', 'highRiskOperations', 'knownLimitations', 'assumptions', 'unknowns', 'evidence'];
  const background: ProjectBackground = {
    projectName: config.name, projectType: config.type, currentStatus: 'verified', problem: config.goal, targetUsers: ['New user'], userTasks: [config.goal], capabilities: [{ id: config.cap, name: config.capName, description: config.goal, status: 'verified', routes: config.routes, evidence: [evidence], dependencies: [], risks: [] }], corePages: config.routes, primaryJourneys: [config.goal], aiResponsibilities: kind === 'ai' ? ['Generate an answer'] : [], ruleResponsibilities: config.constraints, externalDependencies: [], highRiskOperations: [], knownLimitations: [], assumptions: [], unknowns: [], evidence: [evidence], fieldStatuses: Object.fromEntries(fieldNames.map((name) => [name, 'verified'])), fieldEvidence: Object.fromEntries(fieldNames.map((name) => [name, [evidence]])), generatedAt: now,
  };
  const blueprint: EvalBlueprint = {
    projectName: config.name, inScope: [config.capName], outOfScope: [], capabilities: [{ id: config.cap, name: config.capName, importance: 'critical', userGoals: [config.goal], entryPoints: [config.routes[0]!], successConditions: config.success, hardConstraints: config.constraints, failureConditions: ['No result'], dependencies: [], requiredPersonas: ['new'], requiredInputQualities: ['valid'], requiredSystemStates: ['ready'], graders: ['deterministic', 'semantic'], approvalStatus: kind === 'ai' ? 'needs_human_review' : 'approved' }], scenarioDimensions: {}, scoring: { hardAssertions: [], rubricItems: [] }, coverageTargets: {}, releaseGates: [], approvalStatus: kind === 'ai' ? 'needs_human_review' : 'approved', generatedAt: now,
  };
  return { projectId: `project-${kind}`, background, blueprint, routes: { routes: config.routes.map((path) => ({ path, source: 'fixture.ts', status: 'verified' })), sourceFiles: ['fixture.ts'], scannedAt: now }, pages: config.pages, documents: { documents: [{ path: 'README.md', title: config.name, excerpt: `${config.goal}. ${config.success.join('. ')}` }], claims: [], scannedAt: now } };
}

function signal(signalId: string, kind: 'text_visible' | 'text_absent' | 'console_error_absent' | 'semantic', target: string, evidenceRef: string, needsHumanReview = false) {
  return { signalId, kind, target, description: target, evidenceStatus: needsHumanReview ? 'inferred' : 'verified', evidenceRefs: [evidenceRef], needsHumanReview };
}

function productDraft(kind: FixtureKind) {
  if (kind === 'form') return {
    capabilities: [{ capabilityId: 'cap-create', name: 'Create project', description: 'Create one project from the visible form', routes: ['/', '/invented'], entryPoints: ['/'], userGoals: ['Create a project'], importance: 'critical', evidenceStatus: 'verified', evidenceRefs: ['page-1'], needsHumanReview: false }],
    userTasks: [{ taskId: 'task-create', capabilityId: 'cap-create', name: 'Create a safe demo project', goal: 'Create a project', preconditions: [], successConditions: ['Created', 'Safe demo'], successSignals: [signal('signal-created', 'text_visible', 'Created', 'page-1'), signal('signal-demo', 'text_visible', 'Safe demo', 'page-1'), signal('signal-error', 'text_absent', 'Error', 'page-1'), signal('signal-console', 'console_error_absent', 'console', 'page-1')], businessRuleIds: ['rule-publish'], evidenceStatus: 'verified', evidenceRefs: ['page-1'], needsHumanReview: false }],
    objectLifecycles: [{ lifecycleId: 'lifecycle-project', objectName: 'Project', states: ['not_created', 'created'], transitions: [{ transitionId: 'transition-create', fromState: 'not_created', toState: 'created', trigger: 'Create', successSignalIds: ['signal-created'] }], evidenceStatus: 'verified', evidenceRefs: ['page-1'], needsHumanReview: false }],
    crossPageJourneys: [{ journeyId: 'journey-create', name: 'Create project', taskIds: ['task-create'], routes: ['/'], successConditions: ['Created'], evidenceStatus: 'verified', evidenceRefs: ['page-1'], needsHumanReview: false }],
    businessRules: [{ ruleId: 'rule-publish', statement: 'Do not publish automatically', evidenceStatus: 'declared', evidenceRefs: ['blueprint-1'], needsHumanReview: false }], unknowns: [],
  };
  if (kind === 'crud') {
    const tasks = [
      { id: 'task-list', name: 'View records', goal: 'View existing records', route: '/items', success: 'Records' },
      { id: 'task-create', name: 'Create record', goal: 'Create a record', route: '/items/new', success: 'Created record' },
      { id: 'task-edit', name: 'Edit record', goal: 'Edit and persist a record', route: '/items/:id/edit', success: 'Saved changes' },
    ];
    return {
      capabilities: [{ capabilityId: 'cap-item', name: 'Manage records', description: 'View, create, and edit records across pages', routes: ['/items', '/items/new', '/items/:id/edit'], entryPoints: ['/items'], userGoals: tasks.map((item) => item.goal), importance: 'critical', evidenceStatus: 'verified', evidenceRefs: ['page-1', 'page-2', 'page-3'], needsHumanReview: false }],
      userTasks: tasks.map((item, index) => ({ taskId: item.id, capabilityId: 'cap-item', name: item.name, goal: item.goal, preconditions: index === 2 ? ['A record exists'] : [], successConditions: [item.success], successSignals: [signal(`signal-${item.id}`, 'text_visible', item.success, `page-${index + 1}`), signal(`signal-${item.id}-error`, 'text_absent', 'Error', `page-${index + 1}`)], businessRuleIds: ['rule-save'], evidenceStatus: 'verified', evidenceRefs: [`page-${index + 1}`], needsHumanReview: false })),
      objectLifecycles: [{ lifecycleId: 'lifecycle-record', objectName: 'Record', states: ['listed', 'created', 'updated'], transitions: [{ transitionId: 'transition-create', fromState: 'listed', toState: 'created', trigger: 'Create', successSignalIds: ['signal-task-create'] }, { transitionId: 'transition-edit', fromState: 'created', toState: 'updated', trigger: 'Save', successSignalIds: ['signal-task-edit'] }], evidenceStatus: 'verified', evidenceRefs: ['page-1', 'page-2', 'page-3'], needsHumanReview: false }],
      crossPageJourneys: [{ journeyId: 'journey-record', name: 'Create and update record', taskIds: tasks.map((item) => item.id), routes: ['/items', '/items/new', '/items/:id/edit'], successConditions: ['Saved changes'], evidenceStatus: 'verified', evidenceRefs: ['page-1', 'page-2', 'page-3'], needsHumanReview: false }], businessRules: [{ ruleId: 'rule-save', statement: 'Save changes before leaving', evidenceStatus: 'declared', evidenceRefs: ['blueprint-1'], needsHumanReview: false }], unknowns: [],
    };
  }
  return {
    capabilities: [{ capabilityId: 'cap-generate', name: 'Generate answer', description: 'Generate an answer from a prompt', routes: ['/generate'], entryPoints: ['/generate'], userGoals: ['Generate an answer from a prompt'], importance: 'critical', evidenceStatus: 'verified', evidenceRefs: ['page-1'], needsHumanReview: false }],
    userTasks: [{ taskId: 'task-generate', capabilityId: 'cap-generate', name: 'Generate a cited answer', goal: 'Generate an answer from a prompt', preconditions: [], successConditions: ['Generated answer', 'Source links'], successSignals: [signal('signal-answer', 'text_visible', 'Generated answer', 'page-1'), signal('signal-sources', 'text_visible', 'Source links', 'page-1'), signal('signal-hallucination', 'text_absent', 'Fabricated citation', 'blueprint-1', true), signal('signal-relevance', 'semantic', 'Answer addresses the prompt', 'blueprint-1', true)], businessRuleIds: ['rule-citations'], evidenceStatus: 'verified', evidenceRefs: ['page-1'], needsHumanReview: true }],
    objectLifecycles: [{ lifecycleId: 'lifecycle-generation', objectName: 'Generation', states: ['prompt_ready', 'generating', 'completed'], transitions: [{ transitionId: 'transition-generate', fromState: 'prompt_ready', toState: 'completed', trigger: 'Generate', successSignalIds: ['signal-answer'] }], evidenceStatus: 'inferred', evidenceRefs: ['page-1'], needsHumanReview: true }],
    crossPageJourneys: [{ journeyId: 'journey-generate', name: 'Prompt to answer', taskIds: ['task-generate'], routes: ['/generate'], successConditions: ['Generated answer'], evidenceStatus: 'verified', evidenceRefs: ['page-1'], needsHumanReview: true }],
    businessRules: [{ ruleId: 'rule-citations', statement: 'Answers should cite reliable sources', evidenceStatus: 'inferred', evidenceRefs: ['blueprint-1'], needsHumanReview: true }], unknowns: [{ unknownId: 'unknown-citation-quality', question: 'What qualifies as a reliable source?', impact: 'Changes citation judgement', resolutionHint: 'Product owner review' }],
  };
}

const provider = new MockAiProvider((request) => {
  if (request.task === 'product_understanding') {
    const input = JSON.parse(request.userPrompt) as { product: { name: string } };
    return productDraft(input.product.name.startsWith('Form') ? 'form' : input.product.name.startsWith('CRUD') ? 'crud' : 'ai');
  }
  if (request.task === 'oracle_builder') {
    const input = JSON.parse(request.userPrompt) as { task: { taskId: string; goal: string; successConditions: string[]; successSignals: Array<{ signalId: string; kind: string; target: string; needsHumanReview: boolean }> }; businessRules: Array<{ statement: string; needsHumanReview: boolean }> };
    return {
      expectedOutcome: [...input.task.successConditions, 'Invented outcome'],
      mustObserve: input.task.successSignals.filter((item) => item.kind === 'text_visible').map((item) => item.target),
      mustNotObserve: [...input.task.successSignals.filter((item) => item.kind === 'text_absent').map((item) => item.target), '未处理错误'],
      businessRules: [...input.businessRules.map((item) => item.statement), 'Invented business rule'],
      semanticRubric: [`用户是否完成具体任务：${input.task.goal}`],
      deterministicAssertions: [...input.task.successSignals.filter((item) => item.kind !== 'semantic').map((item) => ({ assertionId: `assert-${item.signalId}`, type: item.kind, target: item.target, expected: true, negated: false })), { assertionId: 'assert-invented', type: 'text_visible', target: 'Invented', expected: true, negated: false }],
      inconclusiveWhen: ['任务证据不完整'],
      needsHumanReview: input.task.successSignals.some((item) => item.needsHumanReview) || input.businessRules.some((item) => item.needsHumanReview),
      reviewReasons: input.businessRules.filter((item) => item.needsHumanReview).map((item) => `规则待确认：${item.statement}`),
    };
  }
  return {};
});

describe('Phase 6 Product Task Understanding and Oracle quality', () => {
  it('improves task and Oracle specificity across form, CRUD, and AI generation fixtures without duplicate cases', async () => {
    const comparisons = [];
    for (const kind of ['form', 'crud', 'ai'] as const) {
      const input = fixture(kind);
      const legacyModel = buildProductModel({ projectId: input.projectId, background: input.background, blueprint: input.blueprint, generatedAt: now });
      const legacyCases = generateBaselineCases(legacyModel, now);
      const understood = await understandProductTasks({ ...input, provider, generatedAt: now });
      const enhanced = await generateBaselineCasesWithOracleBuilder(understood.model, provider, { generatedAt: now });
      comparisons.push({ kind, legacyModel, legacyCases, understood, enhanced });
    }

    expect(comparisons.map((item) => item.legacyModel.userTasks.length)).toEqual([1, 1, 1]);
    expect(comparisons.map((item) => item.understood.model.userTasks.length)).toEqual([1, 3, 1]);
    expect(comparisons.flatMap((item) => item.legacyCases).every((item) => item.oracle.deterministicAssertions.length === 0)).toBe(true);
    expect(comparisons.flatMap((item) => item.enhanced.cases).every((item) => item.oracle.mustObserve.length > 0 && item.oracle.deterministicAssertions.length > 0)).toBe(true);
    expect(comparisons.every((item) => new Set(item.enhanced.cases.map((evalCase) => evalCase.caseId)).size === item.enhanced.cases.length)).toBe(true);
    expect(comparisons.find((item) => item.kind === 'ai')?.enhanced.cases[0]).toMatchObject({ needsHumanReview: true });
    expect(comparisons.find((item) => item.kind === 'form')?.understood.model.capabilities[0]?.routes).toEqual(['/']);
    expect(comparisons.find((item) => item.kind === 'form')?.enhanced.cases[0]?.oracle.expectedOutcome).not.toContain('Invented outcome');
    expect(comparisons.flatMap((item) => item.enhanced.cases).flatMap((item) => item.oracle.deterministicAssertions).some((item) => item.target === 'Invented')).toBe(false);
    expect(comparisons.every((item) => item.understood.model.objectLifecycles?.length === 1 && item.understood.model.crossPageJourneys?.length === 1)).toBe(true);
    expect(provider.requests.filter((request) => request.task === 'product_understanding').every((request) => !request.userPrompt.includes('SECRET_SHOULD_NOT_LEAVE'))).toBe(true);
  });

  it('marks inferred rules for human review and keeps them out of automatic product-failure eligibility', async () => {
    const input = fixture('ai');
    const understood = await understandProductTasks({ ...input, provider, generatedAt: now });
    const result = await generateBaselineCasesWithOracleBuilder(understood.model, provider, { generatedAt: now });
    expect(understood.model.businessRules[0]).toMatchObject({ evidenceStatus: 'inferred', needsHumanReview: true });
    expect(result.oracleResults[0]).toMatchObject({ needsHumanReview: true, mode: 'ai' });
    expect(result.cases[0]).toMatchObject({ needsHumanReview: true });
  });

  it('returns an explicit deterministic fallback when the Product Understanding provider output is invalid', async () => {
    const input = fixture('form');
    const invalidProvider = new MockAiProvider(() => ({}), 0);
    const result = await understandProductTasks({ ...input, provider: invalidProvider, generatedAt: now });
    expect(result).toMatchObject({ mode: 'deterministic_fallback', warnings: [expect.stringContaining('确定性兼容模型')] });
    expect(result.model.userTasks).toHaveLength(1);
    expect(result.model.objectLifecycles).toEqual([]);
  });

  it('persists the understood model and specific Oracle through the real foundation generation path', async () => {
    const input = fixture('form');
    const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-product-understanding-'));
    await Promise.all([
      writeYamlAtomic(resolve(outputDir, 'project-background.yaml'), input.background),
      writeYamlAtomic(resolve(outputDir, 'eval-blueprint.yaml'), input.blueprint),
      writeJsonAtomic(resolve(outputDir, 'evidence', 'routes.json'), input.routes),
      writeJsonAtomic(resolve(outputDir, 'evidence', 'pages.json'), input.pages),
      writeJsonAtomic(resolve(outputDir, 'evidence', 'documents.json'), input.documents),
    ]);
    const result = await generateAdaptiveFoundation({ projectId: input.projectId, outputDir, provider, allowRemoteModel: true, generatedAt: now });
    const saved = await loadProductModel(outputDir, 1);
    expect(result).toMatchObject({ generationMode: 'ai', cases: [expect.objectContaining({ oracle: expect.objectContaining({ mustObserve: ['Created', 'Safe demo'] }) })] });
    expect(saved.userTasks[0]?.successSignals).toHaveLength(4);
    expect(saved.objectLifecycles).toHaveLength(1);
  });
});
