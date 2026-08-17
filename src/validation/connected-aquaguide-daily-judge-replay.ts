import type { DeterministicJudgeResult, EvalCase, EvidencePacket } from '../../types.js';
import { runDeterministicJudge } from '../judge/deterministic-judge.js';
import { semanticJudgePromptV1 } from '../prompts/semantic-judge.v1.js';
import { calculateEvidenceCompleteness } from '../test-agent/evidence-packet.js';

export const connectedAquaGuideDailyReplayTargetCommit = '2add55a54402afc18b642b572d8ee8351ab72c53';
export const connectedAquaGuideDailyReplayCaseId = 'blind-daily-check-risk';

export const connectedAquaGuideDailyReplayCase: EvalCase = {
  caseId: connectedAquaGuideDailyReplayCaseId,
  projectId: 'aquaguide-blind-experience',
  setType: 'baseline',
  status: 'stable',
  origin: { type: 'human', note: 'Connected AquaGuide Daily Check Judge replay' },
  capabilityId: 'cap-daily-check',
  taskId: 'task-daily-check-risk',
  title: '完成每日检查并查看风险结果',
  hypothesis: 'Blind user can complete the Daily Check and save the visible high-risk result.',
  persona: {
    personaId: 'persona-blind-new-user',
    name: '首次使用 AquaGuide 的普通用户',
    knowledgeLevel: 'low',
    patienceTurns: 4,
    retryTolerance: 1,
    privacySensitivity: 'medium',
    behaviorPolicy: ['只依据当前可见界面、自己的目标和已知信息行动'],
    exitConditions: ['连续尝试没有进展时退出', '需要危险或未知信息时退出'],
  },
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
    expectedOutcome: ['Daily Check result is visible and the Daily Check record is saved'],
    mustObserve: [],
    mustNotObserve: [],
    businessRules: [],
    semanticRubric: [
      '用户真实进入 Daily Aquarium Check，而不是 Care Guide Quick Check。',
      '用户完成给定检查并看见高风险状态与明确下一步动作。',
      '用户保存今天的 Daily Check 记录。',
    ],
    deterministicAssertions: [
      { assertionId: 'blind-daily-risk', type: 'text_visible', target: 'Act now', expected: true, negated: false },
      { assertionId: 'blind-daily-action', type: 'text_visible', target: 'Do this first', expected: true, negated: false },
      { assertionId: 'blind-daily-recorded-high-risk', type: 'text_visible', target: '已保存今天的检查记录。', expected: true, negated: false },
    ],
    inconclusiveWhen: ['没有足够可见证据确认成功或产品失败'],
  },
  coverageDimensions: [{ dimension: 'capability', value: 'cap-daily-check' }],
  riskLevel: 'P1',
  generationReason: 'Connected AquaGuide Run #10 Judge-only replay',
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
  createdAt: '2026-08-17T06:13:27.705Z',
  updatedAt: '2026-08-17T06:13:27.705Z',
};

export interface ConnectedAquaGuideDailyReplayPreparation {
  sourceRunId: string;
  sourceCaseId: string;
  targetAppGitSha: string | null;
  deterministic: DeterministicJudgeResult;
  promptBytes: {
    system: number;
    user: number;
    total: number;
  };
}

export function prepareConnectedAquaGuideDailyJudgeReplay(input: {
  packet: EvidencePacket;
  expectedTargetCommit?: string;
}): ConnectedAquaGuideDailyReplayPreparation {
  const expectedTargetCommit = input.expectedTargetCommit ?? connectedAquaGuideDailyReplayTargetCommit;
  if (input.packet.caseId !== connectedAquaGuideDailyReplayCaseId) {
    throw new Error(`Judge replay requires case ${connectedAquaGuideDailyReplayCaseId}; received ${input.packet.caseId}.`);
  }
  if (input.packet.targetAppCommit !== expectedTargetCommit || input.packet.versions.targetAppGitSha !== expectedTargetCommit) {
    throw new Error(`Judge replay target mismatch; expected ${expectedTargetCommit}.`);
  }
  const completeness = calculateEvidenceCompleteness(input.packet);
  if (!completeness.complete) {
    throw new Error(`Judge replay requires a complete retained Evidence Packet: ${completeness.missing.join(' ')}`);
  }

  const deterministic = runDeterministicJudge(connectedAquaGuideDailyReplayCase, input.packet);
  const prompt = semanticJudgePromptV1.build({
    evalCase: connectedAquaGuideDailyReplayCase,
    packet: input.packet,
    deterministic,
  });
  const system = Buffer.byteLength(prompt.system, 'utf8');
  const user = Buffer.byteLength(prompt.user, 'utf8');

  return {
    sourceRunId: input.packet.runId,
    sourceCaseId: input.packet.caseId,
    targetAppGitSha: input.packet.targetAppCommit,
    deterministic,
    promptBytes: { system, user, total: system + user },
  };
}
