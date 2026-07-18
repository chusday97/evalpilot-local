import type { CompletionDefinition } from '../../types.js';
import { completionDefinitionSchema } from '../schemas/ux-evaluation.js';

interface ClosureLayerInput {
  conditions: string[];
  evidence: string[];
  satisfied: boolean | null;
}

export interface ClosureInput {
  technical: ClosureLayerInput;
  interface: ClosureLayerInput;
  userGoal: ClosureLayerInput;
  followUp: ClosureLayerInput;
}

export function analyzeClosure(input: ClosureInput): {
  completion: CompletionDefinition;
  technicalComplete: boolean;
  interfaceComplete: boolean;
  userGoalComplete: boolean;
  fullLoopComplete: boolean;
} {
  const completion = completionDefinitionSchema.parse({
    technical: { conditions: input.technical.conditions, complete: input.technical.satisfied, evidence: input.technical.evidence },
    interface: { conditions: input.interface.conditions, complete: input.interface.satisfied, evidence: input.interface.evidence },
    userGoal: { conditions: input.userGoal.conditions, complete: input.userGoal.satisfied, evidence: input.userGoal.evidence },
    followUp: { conditions: input.followUp.conditions, complete: input.followUp.satisfied, evidence: input.followUp.evidence },
  });
  return {
    completion,
    technicalComplete: completion.technical.complete === true,
    interfaceComplete: completion.interface.complete === true,
    userGoalComplete: completion.userGoal.complete === true,
    fullLoopComplete: completion.userGoal.complete === true && completion.followUp.complete === true,
  };
}
