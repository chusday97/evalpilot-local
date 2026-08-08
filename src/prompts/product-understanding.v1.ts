import type { DocumentEvidence, EvalBlueprint, PageEvidence, ProjectBackground, RouteEvidence } from '../../types.js';

export interface ProductUnderstandingEvidenceItem {
  evidenceId: string;
  sourceType: 'repository' | 'document' | 'browser';
  source: string;
  status: 'verified' | 'declared';
  summary: string;
}

export const productUnderstandingPromptV1 = {
  id: 'product-understanding',
  version: '1.0.0',
  build(input: {
    background: ProjectBackground;
    blueprint: EvalBlueprint;
    routes: RouteEvidence;
    pages: PageEvidence[];
    documents: DocumentEvidence;
    existingUnknowns: string[];
    evidenceCatalog: ProductUnderstandingEvidenceItem[];
  }): { system: string; user: string } {
    return {
      system: [
        'Build a task-level product model using only the supplied bounded evidence catalog.',
        'A route is not itself a user task. Prefer observable user goals, object lifecycles, and cross-page journeys.',
        'Every factual item must cite supplied evidence IDs. Never invent routes, UI text, requests, or business rules.',
        'Mark inferred or uncertain rules and relationships needsHumanReview=true.',
        'Success signals must use only the supported enum and describe an observable outcome.',
        'Link each task only to business rule IDs that actually constrain that task.',
        'Return no selectors, source code, credentials, hidden state, or chain-of-thought.',
      ].join(' '),
      user: JSON.stringify({
        product: {
          name: input.background.projectName,
          type: input.background.projectType,
          problem: input.background.problem,
          targetUsers: input.background.targetUsers,
          declaredTasks: input.background.userTasks,
          primaryJourneys: input.background.primaryJourneys,
          capabilities: input.background.capabilities.map(({ id, name, description, routes, dependencies, risks }) => ({ id, name, description, routes, dependencies, risks })),
        },
        blueprint: input.blueprint.capabilities.map(({ id, name, importance, userGoals, entryPoints, successConditions, hardConstraints, failureConditions, dependencies, approvalStatus }) => ({ id, name, importance, userGoals, entryPoints, successConditions, hardConstraints, failureConditions, dependencies, approvalStatus })),
        routes: input.routes.routes.slice(0, 200).map(({ path, source, status }) => ({ path, source, status })),
        visiblePages: input.pages.slice(0, 50).map((page) => ({
          url: page.url,
          title: page.title,
          headings: page.accessibility.headings.slice(0, 20),
          navigation: page.links.slice(0, 30).map(({ text, href }) => ({ text, href })),
          primaryActions: page.buttons.slice(0, 20).map(({ text, disabled, risk }) => ({ text, disabled, risk })),
          forms: page.forms,
          inputs: page.inputs.slice(0, 20).map(({ text, type, name, disabled }) => ({ text, type, name, disabled })),
        })),
        documents: input.documents.documents.slice(0, 50).map(({ path, title, excerpt }) => ({ path, title, excerpt: excerpt.slice(0, 500) })),
        existingUnknowns: input.existingUnknowns,
        evidenceCatalog: input.evidenceCatalog,
      }),
    };
  },
};
