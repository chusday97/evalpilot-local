import type { FeatureJourneyGraph, JourneyStepDefinition } from '../../types.js';

export interface StepOptimization {
  step: JourneyStepDefinition;
  recommendation: 'merge' | 'automate' | 'remove';
  protectedBySafety: false;
}

export function findOptimizableSteps(graph: FeatureJourneyGraph): StepOptimization[] {
  const result: StepOptimization[] = [];
  for (const step of graph.steps) {
    if (step.type === 'mergeable') result.push({ step, recommendation: 'merge', protectedBySafety: false });
    if (step.type === 'automatable') result.push({ step, recommendation: 'automate', protectedBySafety: false });
    if (step.type === 'redundant') result.push({ step, recommendation: 'remove', protectedBySafety: false });
  }
  return result;
}
