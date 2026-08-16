import { describe, expect, it } from 'vitest';
import {
  aggregateConnectedAquaGuideCohort,
  renderConnectedAquaGuideCohortMarkdown,
  type ConnectedSmokeDiagnostic,
  type ConnectedSmokeTaskResult,
} from '../scripts/aggregate-connected-aquaguide-cohort.js';

const caseIds = [
  'blind-create-usable-aquarium',
  'blind-record-existing-livestock',
  'blind-daily-check-risk',
];

function task(caseId: string, overrides: Partial<ConnectedSmokeTaskResult> = {}): ConnectedSmokeTaskResult {
  return {
    caseId,
    executionStatus: 'executed',
    verdict: 'pass',
    failureSource: null,
    runtimeFailureSource: null,
    agentStatus: 'completed',
    actionSequence: ['click', 'click', 'finish'],
    actionCount: 3,
    backtrackCount: 0,
    retryCount: 0,
    repeatedInputCount: 0,
    frictionTypes: [],
    findingTypes: [],
    observedPreFailureSignals: [],
    ...overrides,
  };
}

function run(overrides: Partial<ConnectedSmokeDiagnostic> = {}, tasks?: ConnectedSmokeTaskResult[]): ConnectedSmokeDiagnostic {
  return {
    analysisMode: 'connected_aquaguide_blind_smoke',
    targetAppGitSha: '8663b469c50605529367daf1b69ac0cd7cfb0cac',
    provider: { providerId: 'deepseek', model: 'deepseek-v4-flash' },
    executionConfig: {
      maxAgentSteps: 12,
      allowScreenshotToProvider: false,
      sequentialSharedBrowserContext: true,
      prerequisiteCascadeGuard: true,
      preFailureSignalSidecar: true,
      benchmarkLocale: 'en-US',
      applicationLocale: 'en',
    },
    caseIds,
    protocolHealthy: true,
    allBlind: true,
    actorOracleLeakCount: 0,
    judgeOracleVisible: true,
    providerFailureCount: 0,
    evaluatorFailureCount: 0,
    unknownFailureCount: 0,
    blockedPrerequisiteCount: 0,
    observedPreFailureSignalCount: 0,
    allProductJourneysPassed: true,
    taskResults: tasks ?? caseIds.map((caseId) => task(caseId)),
    ...overrides,
  };
}

describe('connected AquaGuide cohort aggregator', () => {
  it('keeps verdict stability separate from action-path variance', () => {
    const first = run();
    const second = run({}, [
      task(caseIds[0]!),
      task(caseIds[1]!, { actionSequence: ['click', 'fill', 'click', 'back', 'click', 'finish'], actionCount: 6, backtrackCount: 1 }),
      task(caseIds[2]!),
    ]);
    const third = run();

    const summary = aggregateConnectedAquaGuideCohort([first, second, third]);
    const livestock = summary.cases.find((item) => item.caseId === caseIds[1])!;

    expect(summary.cohortComplete).toBe(true);
    expect(summary.fullPassRunCount).toBe(3);
    expect(summary.protocolHealthyRunCount).toBe(3);
    expect(livestock.completedPassCount).toBe(3);
    expect(livestock.completionRate).toBe(1);
    expect(livestock.outcomeStable).toBe(true);
    expect(livestock.actionPathStable).toBe(false);
    expect(livestock.distinctActionPathCount).toBe(2);
    expect(livestock.backtrackRunCount).toBe(1);
    expect(livestock.actionCount).toEqual({ min: 3, max: 6, mean: 4 });
  });

  it('treats provider failure and prerequisite blocking as cohort incidence instead of an aggregator failure', () => {
    const providerInterrupted = run({
      protocolHealthy: false,
      providerFailureCount: 1,
      blockedPrerequisiteCount: 1,
      allProductJourneysPassed: false,
    }, [
      task(caseIds[0]!),
      task(caseIds[1]!, {
        verdict: 'inconclusive',
        failureSource: 'evaluator',
        runtimeFailureSource: 'provider',
        agentStatus: 'inconclusive',
        actionSequence: ['click', 'fill', 'click'],
      }),
      task(caseIds[2]!, {
        executionStatus: 'blocked_prerequisite',
        verdict: null,
        failureSource: null,
        runtimeFailureSource: null,
        agentStatus: null,
        actionSequence: [],
        actionCount: 0,
      }),
    ]);

    const summary = aggregateConnectedAquaGuideCohort([run(), providerInterrupted, run()]);
    const livestock = summary.cases.find((item) => item.caseId === caseIds[1])!;
    const daily = summary.cases.find((item) => item.caseId === caseIds[2])!;

    expect(summary.boundaryHealthy).toBe(true);
    expect(summary.protocolHealthyRunCount).toBe(2);
    expect(summary.providerFailureRunCount).toBe(1);
    expect(summary.blockedPrerequisiteRunCount).toBe(1);
    expect(summary.fullPassRunCount).toBe(2);
    expect(livestock.completedPassCount).toBe(2);
    expect(livestock.outcomeStable).toBe(false);
    expect(livestock.runtimeFailureCounts).toEqual({ none: 2, provider: 1 });
    expect(daily.executionStatusCounts).toEqual({ executed: 2, blocked_prerequisite: 1 });
  });

  it('counts recurrence by run rather than repeated occurrences inside one run', () => {
    const noisy = run({ observedPreFailureSignalCount: 2 }, [
      task(caseIds[0]!),
      task(caseIds[1]!, {
        frictionTypes: ['path_efficiency_issue', 'path_efficiency_issue'],
        findingTypes: ['interaction_feedback_issue', 'interaction_feedback_issue'],
        observedPreFailureSignals: [
          { type: 'action_execution_failure', cause: 'pointer_interception' },
          { type: 'action_execution_failure', cause: 'pointer_interception' },
        ],
      }),
      task(caseIds[2]!),
    ]);

    const summary = aggregateConnectedAquaGuideCohort([noisy, run(), noisy]);
    const livestock = summary.cases.find((item) => item.caseId === caseIds[1])!;

    expect(summary.observedPreFailureSignalRunCount).toBe(2);
    expect(livestock.frictionRecurrence.path_efficiency_issue).toBe(2);
    expect(livestock.findingRecurrence.interaction_feedback_issue).toBe(2);
    expect(livestock.preFailureSignalRecurrence['action_execution_failure:pointer_interception']).toBe(2);
  });

  it('rejects configuration drift between runs', () => {
    const drifted = run({ executionConfig: { ...run().executionConfig, maxAgentSteps: 15 } });
    expect(() => aggregateConnectedAquaGuideCohort([run(), drifted, run()])).toThrow(/configuration drifted/);
  });

  it('renders a human-readable cohort report', () => {
    const summary = aggregateConnectedAquaGuideCohort([run(), run(), run()]);
    const markdown = renderConnectedAquaGuideCohortMarkdown(summary);
    expect(markdown).toContain('# Connected AquaGuide 3-Run Variance Cohort');
    expect(markdown).toContain('Protocol-healthy runs: 3/3');
    expect(markdown).toContain('blind-record-existing-livestock');
    expect(markdown).toContain('frequencies are descriptive observations');
  });
});
