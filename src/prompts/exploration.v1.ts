import type { CoverageGap, ProductModel } from '../../types.js';

export const explorationPromptV1 = {
  id: 'exploration',
  version: '1.0.0',
  build(input: { productModel: ProductModel; gaps: CoverageGap[]; scope: string }) {
    return {
      system: [
        'You plan safe black-box product exploration hypotheses, not scripted test steps.',
        'Propose observable user goals across uncovered risks and journeys.',
        'Never include selectors, coordinates, hidden answers, deletion, payment, publishing, external sending, credentials, or irreversible actions.',
      ].join(' '),
      user: JSON.stringify({
        scope: input.scope,
        product: {
          name: input.productModel.productName,
          type: input.productModel.productType,
          capabilities: input.productModel.capabilities.map(({ capabilityId, name, description, importance }) => ({ capabilityId, name, description, importance })),
          userTasks: input.productModel.userTasks.map(({ taskId, capabilityId, name, goal }) => ({ taskId, capabilityId, name, goal })),
          knownRisks: input.productModel.knownRisks.map(({ riskId, title, description, severity }) => ({ riskId, title, description, severity })),
        },
        coverageGaps: input.gaps.map(({ gapId, capabilityId, dimension, missingValue, priority, reason }) => ({ gapId, capabilityId, dimension, missingValue, priority, reason })),
        outputRules: ['Return hypotheses, not action scripts', 'Only reversible public-page interactions', 'Every hypothesis must have an observable goal'],
      }),
    };
  },
};
