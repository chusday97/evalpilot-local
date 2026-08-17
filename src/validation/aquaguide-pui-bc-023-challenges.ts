import type { EvalCase, ProductModel } from '../../types.js';
import { analyzePassingCase } from '../eval-set/pass-analyzer.js';
import { buildAquaGuideDailyRetestCase } from './aquaguide-daily-retest-contract.js';
import {
  AQUAGUIDE_PUI_BC_023_CONNECTED_RUN_ID,
  AQUAGUIDE_PUI_BC_023_REGRESSION_CASE_ID,
  AQUAGUIDE_PUI_BC_023_TARGET_SHA,
  buildAquaGuidePuiBc023PassingRetest,
} from './aquaguide-pui-bc-023-lifecycle.js';

export const AQUAGUIDE_PUI_BC_023_CHALLENGE_GENERATED_AT = '2026-08-17T14:23:00.000Z';
export const AQUAGUIDE_PUI_BC_023_BOUNDARY_CHALLENGE_ID = 'case-challenge-blind-daily-check-risk-boundary';
export const AQUAGUIDE_PUI_BC_023_JOURNEY_CHALLENGE_ID = 'case-challenge-blind-daily-check-risk-journey';
export const AQUAGUIDE_PUI_BC_023_PERSONA_CHALLENGE_ID = 'case-challenge-blind-daily-check-risk-persona';
export const AQUAGUIDE_PUI_BC_023_LOW_PATIENCE_PERSONA_ID = 'persona-low-patience';

const evidence = [{
  claim: 'AquaGuide Daily Check same-case connected retest passed with a healthy protocol.',
  sourceType: 'browser' as const,
  source: `github-actions://chusday97/evalpilot-local/${AQUAGUIDE_PUI_BC_023_CONNECTED_RUN_ID}`,
  status: 'verified' as const,
}];

export function buildAquaGuidePuiBc023ChallengeModel(): ProductModel {
  return {
    projectId: 'aquaguide-blind-experience',
    version: 1,
    generatedAt: AQUAGUIDE_PUI_BC_023_CHALLENGE_GENERATED_AT,
    productName: 'AquaGuide',
    productType: 'Web aquarium guidance product',
    targetUsers: [
      {
        userTypeId: 'persona-blind-new-user',
        name: '首次使用 AquaGuide 的普通用户',
        description: '首次使用、低领域知识，只依据当前可见界面行动。',
        goals: ['完成今天的 Daily Check 并保存记录'],
        evidenceStatus: 'verified',
        evidence,
        needsHumanReview: false,
      },
      {
        userTypeId: AQUAGUIDE_PUI_BC_023_LOW_PATIENCE_PERSONA_ID,
        name: '低耐心首次用户',
        description: '只愿意尝试一次最明显入口；入口语义不清时立即退出。',
        goals: ['快速找到 Daily Check、完成并理解风险结果'],
        evidenceStatus: 'inferred',
        evidence,
        needsHumanReview: false,
      },
    ],
    capabilities: [{
      capabilityId: 'cap-daily-check',
      name: 'Daily Check',
      description: '完成日常观察、生成风险结果并保存当天检查记录。',
      routes: ['/aquarium'],
      entryPoints: ['/aquarium'],
      userGoals: ['完成今天的 Daily Check 并保存记录'],
      supportedTasks: ['task-daily-check-risk'],
      importance: 'high',
      evidenceStatus: 'verified',
      evidence,
      needsHumanReview: false,
    }],
    userTasks: [{
      taskId: 'task-daily-check-risk',
      capabilityId: 'cap-daily-check',
      name: '完成 Daily Check 并查看高风险结果',
      goal: '完成每日检查：鱼经常浮头，其余观察正常，并查看系统给出的风险和下一步动作',
      preconditions: ['已有可用鱼缸和生物记录'],
      successConditions: ['进入真实 Daily Check', '完成六项观察', '保存当天记录', '结果与输入一致'],
      evidenceStatus: 'verified',
      evidence,
      needsHumanReview: false,
    }],
    businessRules: [],
    knownRisks: [],
    unknowns: [],
    evidence,
  };
}

export function buildAquaGuidePuiBc023ChallengeAnalysis() {
  const sourceCase = buildAquaGuideDailyRetestCase();
  return analyzePassingCase({
    evalCase: sourceCase,
    result: buildAquaGuidePuiBc023PassingRetest(),
    model: buildAquaGuidePuiBc023ChallengeModel(),
    existingCases: [sourceCase],
    generatedAt: AQUAGUIDE_PUI_BC_023_CHALLENGE_GENERATED_AT,
  });
}

export function selectAquaGuidePuiBc023NextChallenge(): EvalCase {
  const candidate = buildAquaGuidePuiBc023ChallengeAnalysis().challengeCandidates.find((item) =>
    item.coverageDimensions.some((entry) => entry.dimension === 'persona' && entry.value === AQUAGUIDE_PUI_BC_023_LOW_PATIENCE_PERSONA_ID));
  if (!candidate) throw new Error('AquaGuide PUI-BC-023 low-patience persona challenge was not generated.');
  return candidate;
}

export function aquaGuidePuiBc023ChallengeSummary() {
  const analysis = buildAquaGuidePuiBc023ChallengeAnalysis();
  return {
    sourceRegressionCaseId: AQUAGUIDE_PUI_BC_023_REGRESSION_CASE_ID,
    sourceCaseId: 'blind-daily-check-risk',
    sourceConnectedRunId: AQUAGUIDE_PUI_BC_023_CONNECTED_RUN_ID,
    targetAppGitSha: AQUAGUIDE_PUI_BC_023_TARGET_SHA,
    candidateIds: analysis.challengeCandidates.map((item) => item.caseId),
    selectedNextCandidateId: selectAquaGuidePuiBc023NextChallenge().caseId,
  };
}
