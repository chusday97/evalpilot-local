import type { FeatureJourneyGraph, InteractionAction, JourneyComparison, SimulatedUserMetrics } from '../../types.js';
import { journeyComparisonSchema } from '../schemas/ux-evaluation.js';

export function compareJourneys(
  graph: FeatureJourneyGraph,
  actions: InteractionAction[],
  metrics: SimulatedUserMetrics,
  runId: string,
): JourneyComparison {
  const shortestReasonableActionCount = graph.steps.filter((step) =>
    step.type === 'required' || step.type === 'safety' || step.type === 'explanation'
  ).length;
  return journeyComparisonSchema.parse({
    featureId: graph.featureId,
    runId,
    idealActionCount: graph.primaryPath.length,
    actualActionCount: actions.length,
    shortestReasonableActionCount,
    extraActionCount: Math.max(
      0,
      actions.length - shortestReasonableActionCount,
      metrics.redundantActions + metrics.backtrackCount + metrics.repeatedInputCount,
    ),
    pageTransitions: metrics.pageTransitions,
    backtrackCount: metrics.backtrackCount,
    repeatedInputCount: metrics.repeatedInputCount,
    deadEndCount: metrics.deadEndCount,
    taskCompleted: metrics.taskCompleted,
    fullLoopCompleted: metrics.fullLoopCompleted,
    evidence: actions.flatMap((action) => action.evidence),
  });
}
