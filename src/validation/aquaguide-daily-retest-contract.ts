import type { EvalCase } from '../../types.js';

export const AQUAGUIDE_DAILY_RETEST_DEFAULT_TARGET = '3d73c033b6899e3a92144f6de99a05db8babde78';
export const AQUAGUIDE_DAILY_RETEST_CASE_ID = 'blind-daily-check-risk';
export const AQUAGUIDE_DAILY_RETEST_ANALYSIS_MODE = 'connected_aquaguide_daily_blind_retest';
export const AQUAGUIDE_DAILY_RETEST_ORACLE_MARKER = 'SECRET_ORACLE_ONLY_MARKER_DO_NOT_SEND_TO_ACTOR';
export const AQUAGUIDE_DAILY_RETEST_SETUP_MODE = 'aquaguide_gp003_local_storage_fixture';

const persona: EvalCase['persona'] = {
  personaId: 'persona-blind-new-user',
  name: '首次使用 AquaGuide 的普通用户',
  knowledgeLevel: 'low',
  patienceTurns: 4,
  retryTolerance: 1,
  privacySensitivity: 'medium',
  behaviorPolicy: [
    '只依据当前可见界面、自己的目标和已知信息行动',
    '优先选择语义上最接近当前目标的安全入口',
    '不知道的信息保持未知，不为了完成任务自行补齐',
    '看不到可靠下一步时允许退出，不凭空猜测隐藏状态',
  ],
  exitConditions: ['连续尝试没有进展时退出', '需要危险或未知信息时退出'],
};

export function buildAquaGuideDailyRetestCase(): EvalCase {
  const now = '2026-08-17T00:00:00.000Z';
  return {
    caseId: AQUAGUIDE_DAILY_RETEST_CASE_ID,
    projectId: 'aquaguide-blind-experience',
    setType: 'baseline',
    status: 'stable',
    origin: { type: 'human', note: 'Same-case connected regression for PUI-BC-023 / PUI-BC-024' },
    capabilityId: 'cap-daily-check',
    taskId: 'task-daily-check-risk',
    title: '完成每日检查并查看风险结果',
    hypothesis: 'Blind user can complete the real Daily Check and receive a breathing-only warning when all water observations are normal.',
    persona,
    goal: '完成每日检查：鱼经常浮头，其余观察正常，并查看系统给出的风险和下一步动作',
    knownInformation: {
      respiration: '经常浮头',
      waterClarity: '清澈',
      surface: '没有泡沫或油膜',
      odor: '没有异味',
      behavior: '正常游动和进食',
      recentOperation: '没有特别操作',
    },
    preconditions: [],
    oracle: {
      expectedOutcome: [
        '独立 Judge 验证：用户进入真实 Daily Check、保存当天记录，并获得与输入一致的呼吸异常结果。',
        AQUAGUIDE_DAILY_RETEST_ORACLE_MARKER,
      ],
      mustObserve: [],
      mustNotObserve: [],
      businessRules: [],
      semanticRubric: [
        '用户必须完成 Daily Check 而不是 Care Guide Quick Check。',
        '鱼经常浮头但水体、气味、行为和近期操作正常时，不得把结果解释成已观察到水体异常。',
        AQUAGUIDE_DAILY_RETEST_ORACLE_MARKER,
      ],
      deterministicAssertions: [
        { assertionId: 'blind-daily-risk', type: 'text_visible', target: 'Act now', expected: true, negated: false },
        { assertionId: 'blind-daily-action', type: 'text_visible', target: 'Do this first', expected: true, negated: false },
        { assertionId: 'blind-daily-recorded-high-risk', type: 'text_visible', target: '已保存今天的检查记录。', expected: true, negated: false },
        {
          assertionId: 'blind-daily-breathing-only-summary',
          type: 'text_visible',
          target: '经常浮头或呼吸明显急促需要优先按缺氧、水温或过滤异常排查。',
          expected: true,
          negated: false,
        },
        {
          assertionId: 'blind-daily-no-false-water-abnormal-summary',
          type: 'text_absent',
          target: '鱼浮头并伴随水体异常',
          expected: true,
          negated: false,
        },
        {
          assertionId: 'blind-daily-no-false-water-change-action',
          type: 'text_absent',
          target: '少量换水 20%-30%',
          expected: true,
          negated: false,
        },
      ],
      inconclusiveWhen: ['没有足够可见证据确认成功或产品失败'],
    },
    coverageDimensions: [{ dimension: 'capability', value: 'cap-daily-check' }],
    riskLevel: 'P1',
    generationReason: 'Connected same-case Daily regression after PUI-BC-023 / PUI-BC-024 product fixes',
    version: 1,
    stats: {
      passCount: 0,
      failCount: 0,
      inconclusiveCount: 0,
      latestResult: null,
      latestRunId: null,
      uniqueCoverageContribution: 1,
      lastExecutedAt: null,
    },
    regressionMetadata: null,
    retirementReason: null,
    needsHumanReview: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function buildAquaGuideDailyRetestState(now = new Date()): Record<string, unknown> {
  const today = now.toISOString().slice(0, 10);
  const timestamp = now.toISOString();
  return {
    version: 1,
    currentAquariumId: 'tank-connected-daily-retest',
    aquariums: [{
      id: 'tank-connected-daily-retest',
      name: 'Connected Daily Retest Tank',
      fishes: [{
        id: 'stock-connected-daily-retest',
        fishId: 'sp_0001',
        quantity: 6,
        entryDate: today,
        lastWaterChangeDate: today,
        batches: [{
          id: 'batch-connected-daily-retest',
          quantity: 6,
          entryDate: today,
          lifeStage: 'unknown',
          reproductiveState: 'unknown',
          stateUpdatedAt: timestamp,
        }],
      }],
      lastWaterChangeDate: today,
      waterChangeHistory: [today],
      dimensions: { length: '60', width: '30', height: '30' },
      waterType: 'Freshwater',
      targetTemperature: '25',
      substrate: '无',
      plants: [],
      hardscape: [],
      equipment: { filter: '瀑布过滤', heater: true, oxygen: true, light: '普通灯' },
    }],
    wishlist: [],
    dismissedRecommendations: [],
    diagnosisRecords: [],
    compatibilityRecords: [],
    deceasedRecords: [],
    feedingRecords: [],
    observationRecords: [],
    riskReminderState: {},
    onboarding: {
      version: 1,
      status: 'completed',
      goal: 'build_tank',
      viewedSpecies: true,
      aquariumConfigured: true,
      taskCardDismissed: true,
    },
    updatedAt: timestamp,
  };
}
