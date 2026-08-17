import type { Badcase, EvalCaseResult } from '../../types.js';
import { promoteFixedBadcaseToRegression } from '../badcase/regression-promoter.js';
import { buildAquaGuideDailyRetestCase } from './aquaguide-daily-retest-contract.js';

export const AQUAGUIDE_PUI_BC_023_CONNECTED_RUN_ID = '32035944562';
export const AQUAGUIDE_PUI_BC_023_PASSING_RUN_ID = 'run-ai-2026-08-17T13-54-33-447Z';
export const AQUAGUIDE_PUI_BC_023_FIRST_FAILED_RUN_ID = 'run-ai-2026-08-17T04-51-28-572Z';
export const AQUAGUIDE_PUI_BC_023_TARGET_SHA = '3d73c033b6899e3a92144f6de99a05db8babde78';
export const AQUAGUIDE_PUI_BC_023_FIXED_AT = '2026-08-17T14:00:38.111Z';
export const AQUAGUIDE_PUI_BC_023_REGRESSION_CASE_ID = 'case-regression-pui-bc-023';

const connectedEvidenceRef = `github-actions://chusday97/evalpilot-local/${AQUAGUIDE_PUI_BC_023_CONNECTED_RUN_ID}/artifacts/9291145132`;

export function buildAquaGuidePuiBc023FixedBadcase(): Badcase {
  return {
    badcaseId: 'PUI-BC-023',
    projectId: 'aquaguide-blind-experience',
    caseId: 'blind-daily-check-risk',
    runId: AQUAGUIDE_PUI_BC_023_FIRST_FAILED_RUN_ID,
    category: 'navigation',
    title: 'Daily Tank Check is confused with Care Guide symptom checks',
    observedFailure: 'Two independent connected blind runs selected Care Guide / Quick Check instead of the visible Daily Tank Check entry, so no Daily record was persisted.',
    userImpact: 'A goal that requires recording today\'s Daily Check can terminate in a troubleshooting flow that does not satisfy the persistence contract.',
    severity: 'P1',
    confirmedFacts: [
      'Run #8 was protocol-healthy and classified the wrong-path Daily outcome as a product failure.',
      'The product fix exposed Daily Check as an explicit aquarium task without making Care Guide auto-save a Daily record.',
      `Connected retest ${AQUAGUIDE_PUI_BC_023_CONNECTED_RUN_ID} passed the same EvalCase against AquaGuide ${AQUAGUIDE_PUI_BC_023_TARGET_SHA}.`,
      'The passing retest entered the real Daily Aquarium Check, completed six observations, generated the result, and saved today\'s record.',
    ],
    rootCauseHypotheses: [{
      hypothesis: 'Daily Tank Check and Care Guide symptom checking competed semantically in the aquarium information architecture.',
      confidence: 0.95,
      supportingEvidence: ['Runs #7 and #8 independently chose Care Guide first while the Daily controls were visible.', 'The explicit Daily task entry changed the blind Actor first route and the same case later passed.'],
      contradictingEvidence: [],
      howToVerify: [`Same-case connected retest ${AQUAGUIDE_PUI_BC_023_CONNECTED_RUN_ID} with Actor blind to the Oracle.`],
    }],
    unknowns: ['This AI-blind evidence does not estimate the failure rate for human users.'],
    evidenceRefs: [connectedEvidenceRef, 'github-issue://chusday97/aquaguide-tank-guide/66'],
    fixStatus: 'fixed',
    regressionCaseId: null,
    createdAt: '2026-08-17T04:51:28.572Z',
    updatedAt: AQUAGUIDE_PUI_BC_023_FIXED_AT,
  };
}

export function buildAquaGuidePuiBc023PassingRetest(): EvalCaseResult {
  const deterministicChecks = [
    ['blind-daily-risk', '最终页面包含“Act now”。'],
    ['blind-daily-action', '最终页面包含“Do this first”。'],
    ['blind-daily-recorded-high-risk', '最终页面包含“已保存今天的检查记录。”。'],
    ['blind-daily-breathing-only-summary', '最终页面包含呼吸异常专属 summary。'],
    ['blind-daily-no-false-water-abnormal-summary', '最终页面不包含错误的水体异常 summary。'],
    ['blind-daily-no-false-water-change-action', '最终页面不包含错误的 20%-30% 换水动作。'],
  ].map(([assertionId, summary]) => ({ assertionId, verdict: 'pass' as const, summary, evidenceRefs: [connectedEvidenceRef] }));

  return {
    runId: AQUAGUIDE_PUI_BC_023_PASSING_RUN_ID,
    caseId: 'blind-daily-check-risk',
    verdict: 'pass',
    failureSource: null,
    severity: null,
    deterministic: {
      checks: deterministicChecks,
      hardFailure: false,
      severity: null,
      evidenceRefs: [connectedEvidenceRef],
    },
    semantic: {
      verdict: 'pass',
      taskCompletion: 'complete',
      summary: 'The blind user entered the real Daily Aquarium Check, completed all six observations, generated the breathing-only risk result, and saved today\'s record without false water-abnormal output.',
      whatWorked: ['Real Daily Check entry selected.', 'Daily record persisted.', 'Breathing-only warning remained consistent with the supplied observations.'],
      whatFailed: [],
      whyItMatters: ['This is the same-case connected PASS required to close PUI-BC-023 and promote it into Regression.'],
      confirmedFacts: ['protocolHealthy=true', 'provider/evaluator/unknown failure counts are all zero', 'all six deterministic assertions passed'],
      hypotheses: [],
      unknowns: ['No claim is made about human-user failure rate.'],
      evidenceRefs: [connectedEvidenceRef],
      confidence: 0.95,
    },
    evidencePacketPath: `${connectedEvidenceRef}/runs/${AQUAGUIDE_PUI_BC_023_PASSING_RUN_ID}/evidence-packet.json`,
    createdAt: AQUAGUIDE_PUI_BC_023_FIXED_AT,
  };
}

export async function promoteAquaGuidePuiBc023(outputDir: string) {
  return promoteFixedBadcaseToRegression({
    outputDir,
    badcase: buildAquaGuidePuiBc023FixedBadcase(),
    sourceCase: buildAquaGuideDailyRetestCase(),
    passingRetest: buildAquaGuidePuiBc023PassingRetest(),
    fixedAt: AQUAGUIDE_PUI_BC_023_FIXED_AT,
    fixTaskId: null,
  });
}
