import type { AiProvider } from '../ai/provider.js';
import type {
  DocumentEvidence,
  EvalBlueprint,
  EvidenceClaim,
  FactStatus,
  PageEvidence,
  ProductModel,
  ProjectBackground,
  RouteEvidence,
} from '../../types.js';
import { buildProductModel } from './product-model-builder.js';
import { productModelSchema, productUnderstandingDraftSchema } from './schemas.js';
import { productUnderstandingPromptV1, type ProductUnderstandingEvidenceItem } from '../prompts/product-understanding.v1.js';

export interface ProductUnderstandingResult {
  model: ProductModel;
  mode: 'ai' | 'deterministic_fallback';
  warnings: string[];
}

function evidenceCatalog(input: {
  background: ProjectBackground;
  blueprint: EvalBlueprint;
  routes: RouteEvidence;
  pages: PageEvidence[];
  documents: DocumentEvidence;
}): ProductUnderstandingEvidenceItem[] {
  const catalog: ProductUnderstandingEvidenceItem[] = [];
  input.background.evidence.slice(0, 100).forEach((claim, index) => catalog.push({ evidenceId: `background-${index + 1}`, sourceType: claim.sourceType === 'document' ? 'document' : claim.sourceType === 'browser' ? 'browser' : 'repository', source: claim.source, status: claim.status === 'verified' ? 'verified' : 'declared', summary: claim.claim }));
  input.routes.routes.slice(0, 200).forEach((route, index) => catalog.push({ evidenceId: `route-${index + 1}`, sourceType: 'repository', source: route.source, status: route.status === 'verified' ? 'verified' : 'declared', summary: `路由 ${route.path}` }));
  input.pages.slice(0, 50).forEach((page, index) => catalog.push({ evidenceId: `page-${index + 1}`, sourceType: 'browser', source: page.url, status: 'verified', summary: [page.title, ...page.accessibility.headings.slice(0, 5), ...page.buttons.slice(0, 5).map((button) => button.text)].filter(Boolean).join(' · ') }));
  input.documents.documents.slice(0, 50).forEach((document, index) => catalog.push({ evidenceId: `document-${index + 1}`, sourceType: 'document', source: document.path, status: 'declared', summary: `${document.title}: ${document.excerpt.slice(0, 240)}` }));
  input.blueprint.capabilities.slice(0, 100).forEach((capability, index) => catalog.push({ evidenceId: `blueprint-${index + 1}`, sourceType: 'document', source: 'eval-blueprint.yaml', status: capability.approvalStatus === 'approved' ? 'declared' : 'declared', summary: `${capability.name}: ${capability.userGoals.join('；')}；成功=${capability.successConditions.join('；')}` }));
  return catalog;
}

const routeBase = 'http://evalpilot.local';

function normalizeRoute(route: string): string | null {
  try {
    const parsed = new URL(route, routeBase);
    return parsed.pathname || '/';
  } catch {
    return null;
  }
}

function normalizeEntryPoint(entryPoint: string): { value: string; route: string } | null {
  try {
    const parsed = new URL(entryPoint, routeBase);
    const route = parsed.pathname || '/';
    return { value: `${route}${parsed.search}${parsed.hash}`, route };
  } catch {
    return null;
  }
}

function mappedEvidence(references: string[], catalog: Map<string, ProductUnderstandingEvidenceItem>): EvidenceClaim[] {
  return [...new Set(references)].flatMap((reference) => {
    const item = catalog.get(reference);
    return item ? [{ claim: item.summary, sourceType: item.sourceType, source: item.source, status: item.status } satisfies EvidenceClaim] : [];
  });
}

function evidenceStatus(requested: FactStatus, evidence: EvidenceClaim[]): FactStatus {
  if (requested === 'verified' && !evidence.some((item) => item.status === 'verified')) return 'inferred';
  if (requested === 'declared' && evidence.length === 0) return 'inferred';
  return evidence.length ? requested : 'inferred';
}

function uniqueById<T>(items: T[], getId: (item: T) => string, label: string, warnings: string[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = getId(item);
    if (seen.has(id)) { warnings.push(`${label} ${id} 重复，已保留第一项。`); return false; }
    seen.add(id); return true;
  });
}

export async function understandProductTasks(input: {
  projectId: string;
  background: ProjectBackground;
  blueprint: EvalBlueprint;
  routes: RouteEvidence;
  pages: PageEvidence[];
  documents: DocumentEvidence;
  provider: AiProvider;
  existingUnknowns?: string[];
  version?: number;
  generatedAt?: string;
  allowRemoteModel?: boolean;
}): Promise<ProductUnderstandingResult> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const fallback = buildProductModel({ projectId: input.projectId, background: input.background, blueprint: input.blueprint, version: input.version, generatedAt });
  const catalogItems = evidenceCatalog(input);
  const catalog = new Map(catalogItems.map((item) => [item.evidenceId, item]));
  const knownRoutes = new Set([
    ...input.routes.routes.map((route) => normalizeRoute(route.path)),
    ...input.pages.map((page) => normalizeRoute(page.url)),
  ].filter((route): route is string => Boolean(route)));
  const prompt = productUnderstandingPromptV1.build({ ...input, existingUnknowns: [...new Set([...(input.existingUnknowns ?? []), ...input.background.unknowns])], evidenceCatalog: catalogItems });
  try {
    const draft = await input.provider.generateStructured({
      requestId: `product-understanding-${input.projectId}-v${input.version ?? 1}`,
      task: 'product_understanding',
      systemPrompt: prompt.system,
      userPrompt: prompt.user,
      schemaName: 'product_understanding_draft',
      imageDataUrls: [],
      privacy: { allowRemoteModel: input.provider.info.remote ? input.allowRemoteModel === true : true, allowScreenshot: false, visibleTextOnly: true, redactionApplied: true },
      metadata: { projectId: input.projectId, promptVersion: productUnderstandingPromptV1.version },
    }, productUnderstandingDraftSchema);
    const warnings: string[] = [];
    const capabilities = uniqueById(draft.capabilities, (item) => item.capabilityId, '能力', warnings).map((item) => {
      const { evidenceRefs, ...fields } = item;
      const evidence = mappedEvidence(item.evidenceRefs, catalog);
      const routes = [...new Set(item.routes.map(normalizeRoute).filter((route): route is string => Boolean(route && knownRoutes.has(route))))];
      const entryPoints = [...new Set(item.entryPoints
        .map(normalizeEntryPoint)
        .filter((entry): entry is { value: string; route: string } => Boolean(entry && knownRoutes.has(entry.route)))
        .map((entry) => entry.value))];
      const routeMismatch = routes.length !== item.routes.length || entryPoints.length !== item.entryPoints.length;
      if (routeMismatch) warnings.push(`能力 ${item.capabilityId} 的未知路由或入口已过滤。`);
      const status = evidenceStatus(item.evidenceStatus, evidence);
      return { ...fields, routes, entryPoints, supportedTasks: [] as string[], evidenceStatus: status, evidence, needsHumanReview: item.needsHumanReview || routeMismatch || status === 'inferred' || status === 'unknown' };
    });
    const capabilityIds = new Set(capabilities.map((item) => item.capabilityId));
    const draftRuleIds = new Set(draft.businessRules.map((item) => item.ruleId));
    const userTasks = uniqueById(draft.userTasks, (item) => item.taskId, '任务', warnings).flatMap((item) => {
      if (!capabilityIds.has(item.capabilityId)) { warnings.push(`任务 ${item.taskId} 引用了未知能力，已过滤。`); return []; }
      const { evidenceRefs, successSignals: draftSignals, ...fields } = item;
      const evidence = mappedEvidence(item.evidenceRefs, catalog);
      const status = evidenceStatus(item.evidenceStatus, evidence);
      const successSignals = uniqueById(draftSignals, (signal) => signal.signalId, `任务 ${item.taskId} 的成功信号`, warnings).map((signal) => {
        const { evidenceRefs: signalEvidenceRefs, ...signalFields } = signal;
        const signalEvidence = mappedEvidence(signal.evidenceRefs, catalog);
        const signalStatus = evidenceStatus(signal.evidenceStatus, signalEvidence);
        return { ...signalFields, evidenceStatus: signalStatus, evidence: signalEvidence, needsHumanReview: signal.needsHumanReview || signalStatus === 'inferred' || signalStatus === 'unknown' };
      });
      const allowedSuccessConditions = new Set(successSignals.flatMap((signal) => [signal.target, signal.description]));
      const successConditions = item.successConditions.filter((condition) => allowedSuccessConditions.has(condition));
      const successMismatch = successConditions.length !== item.successConditions.length;
      const businessRuleIds = item.businessRuleIds.filter((ruleId) => draftRuleIds.has(ruleId));
      const ruleMismatch = businessRuleIds.length !== item.businessRuleIds.length;
      if (successMismatch) warnings.push(`任务 ${item.taskId} 中没有成功信号支持的完成条件已过滤。`);
      if (ruleMismatch) warnings.push(`任务 ${item.taskId} 引用的未知业务规则已过滤。`);
      return [{ ...fields, businessRuleIds, successConditions: successConditions.length ? successConditions : successSignals.map((signal) => signal.description), successSignals, evidenceStatus: status, evidence, needsHumanReview: item.needsHumanReview || successMismatch || ruleMismatch || status === 'inferred' || status === 'unknown' || successSignals.some((signal) => signal.needsHumanReview) }];
    });
    const taskIds = new Set(userTasks.map((item) => item.taskId));
    if (!capabilities.length || !userTasks.length) throw new Error('Product Understanding 没有产生可关联的能力和用户任务。');
    for (const capability of capabilities) capability.supportedTasks = userTasks.filter((task) => task.capabilityId === capability.capabilityId).map((task) => task.taskId);
    const allSignalIds = new Set(userTasks.flatMap((task) => task.successSignals?.map((signal) => signal.signalId) ?? []));
    const objectLifecycles = uniqueById(draft.objectLifecycles, (item) => item.lifecycleId, '对象生命周期', warnings).map((item) => {
      const { evidenceRefs, ...fields } = item;
      const evidence = mappedEvidence(item.evidenceRefs, catalog); const status = evidenceStatus(item.evidenceStatus, evidence);
      const transitions = item.transitions.map((transition) => ({ ...transition, successSignalIds: transition.successSignalIds.filter((id) => allSignalIds.has(id)) }));
      const lostSignals = transitions.some((transition, index) => transition.successSignalIds.length !== item.transitions[index]?.successSignalIds.length);
      if (lostSignals) warnings.push(`对象生命周期 ${item.lifecycleId} 的未知成功信号已过滤。`);
      return { ...fields, transitions, evidenceStatus: status, evidence, needsHumanReview: item.needsHumanReview || lostSignals || status === 'inferred' || status === 'unknown' };
    });
    const crossPageJourneys = uniqueById(draft.crossPageJourneys, (item) => item.journeyId, '跨页旅程', warnings).flatMap((item) => {
      const validTaskIds = item.taskIds.filter((id) => taskIds.has(id));
      if (!validTaskIds.length) { warnings.push(`跨页旅程 ${item.journeyId} 没有有效任务，已过滤。`); return []; }
      const { evidenceRefs, ...fields } = item;
      const evidence = mappedEvidence(item.evidenceRefs, catalog); const status = evidenceStatus(item.evidenceStatus, evidence);
      const routes = [...new Set(item.routes.map(normalizeRoute).filter((route): route is string => Boolean(route && knownRoutes.has(route))))];
      const incomplete = validTaskIds.length !== item.taskIds.length || routes.length !== item.routes.length;
      return [{ ...fields, taskIds: validTaskIds, routes, evidenceStatus: status, evidence, needsHumanReview: item.needsHumanReview || incomplete || status === 'inferred' || status === 'unknown' }];
    });
    const businessRules = uniqueById(draft.businessRules, (item) => item.ruleId, '业务规则', warnings).map((item) => {
      const { evidenceRefs, ...fields } = item;
      const evidence = mappedEvidence(item.evidenceRefs, catalog); const status = evidenceStatus(item.evidenceStatus, evidence);
      return { ...fields, evidenceStatus: status, evidence, needsHumanReview: item.needsHumanReview || status === 'inferred' || status === 'unknown' };
    });
    const model = productModelSchema.parse({ ...fallback, capabilities, userTasks, objectLifecycles, crossPageJourneys, businessRules, unknowns: [...fallback.unknowns, ...draft.unknowns.filter((item) => !fallback.unknowns.some((existing) => existing.question === item.question))] });
    return { model, mode: 'ai', warnings };
  } catch (error) {
    return {
      model: productModelSchema.parse({ ...fallback, objectLifecycles: [], crossPageJourneys: [] }),
      mode: 'deterministic_fallback',
      warnings: [`Product Understanding 未完成，已保留确定性兼容模型：${error instanceof Error ? error.message : String(error)}`],
    };
  }
}
