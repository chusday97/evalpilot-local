import type { CoverageReport, EvalBlueprint, Persona, Scenario } from '../../types.js';

function dimension(coveredValues: string[], expectedValues: string[]): CoverageReport['dimensions'][string] {
  const covered = [...new Set(coveredValues)].sort();
  const missing = expectedValues.filter((value) => !covered.includes(value));
  return { covered, missing, ratio: expectedValues.length ? (expectedValues.length - missing.length) / expectedValues.length : 1 };
}

export function calculateCoverage(scenarios: Scenario[], blueprint: EvalBlueprint, personas: Persona[]): CoverageReport {
  return {
    totalCases: scenarios.length,
    automatedCases: scenarios.filter((scenario) => scenario.automationStatus === 'automated').length,
    dimensions: {
      capabilities: dimension(
        scenarios.map((scenario) => scenario.capability),
        blueprint.capabilities.map((capability) => capability.id),
      ),
      personas: dimension(
        scenarios.map((scenario) => scenario.persona),
        personas.map((persona) => persona.personaId),
      ),
      inputQuality: dimension(scenarios.map((scenario) => scenario.inputQuality), blueprint.scenarioDimensions.inputQuality ?? []),
      systemState: dimension(scenarios.map((scenario) => scenario.systemState), blueprint.scenarioDimensions.systemState ?? []),
      intentType: dimension(scenarios.map((scenario) => scenario.intentType), blueprint.scenarioDimensions.intentType ?? []),
      journeyStage: dimension(scenarios.map((scenario) => scenario.journeyStage), blueprint.scenarioDimensions.journeyStage ?? []),
    },
  };
}
