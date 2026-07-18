import type { ExploratoryScenario, Persona } from '../../types.js';

export interface ExplorationContext {
  goal: string;
  knownInformation: Record<string, unknown>;
  persona: Pick<Persona, 'personaId' | 'name' | 'primaryGoal' | 'knowledgeLevel' | 'expressionQuality' | 'patienceTurns' | 'errorProbability' | 'trustLevel' | 'privacySensitivity' | 'behaviorPolicy' | 'exitConditions'>;
  startingUrl: string;
  allowedActions: string[];
  forbiddenActions: string[];
  successConditions: string[];
  abandonmentPolicy: ExploratoryScenario['abandonmentPolicy'];
}

export function buildExplorationContext(scenario: ExploratoryScenario, persona: Persona): ExplorationContext {
  if (scenario.personaId !== persona.personaId) {
    throw new Error(`探索案例 ${scenario.caseId} 与 Persona ${persona.personaId} 不匹配`);
  }
  return {
    goal: scenario.goal,
    knownInformation: scenario.knownInformation,
    persona: {
      personaId: persona.personaId,
      name: persona.name,
      primaryGoal: persona.primaryGoal,
      knowledgeLevel: persona.knowledgeLevel,
      expressionQuality: persona.expressionQuality,
      patienceTurns: persona.patienceTurns,
      errorProbability: persona.errorProbability,
      trustLevel: persona.trustLevel,
      privacySensitivity: persona.privacySensitivity,
      behaviorPolicy: persona.behaviorPolicy,
      exitConditions: persona.exitConditions,
    },
    startingUrl: scenario.startingUrl,
    allowedActions: scenario.allowedActions,
    forbiddenActions: scenario.forbiddenActions,
    successConditions: scenario.successConditions,
    abandonmentPolicy: scenario.abandonmentPolicy,
  };
}
