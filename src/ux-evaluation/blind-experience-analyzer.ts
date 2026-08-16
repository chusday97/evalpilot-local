import type {
  AiTestAgentRun,
  CompletionDefinition,
  EvalCase,
  EvalCaseResult,
  EvidencePacket,
  FrictionEvent,
  SimulatedUserMetrics,
  UxIssueType,
} from '../../types.js';
import { simulatedUserMetricsSchema } from '../schemas/ux-evaluation.js';
import { analyzeAdaptiveExperience, type AdaptiveExperienceStep } from './adaptive-experience-analyzer.js';
import { detectDeterministicExecutionFrictions, detectFrictions } from './friction-detector.js';
import { calculateInteractionMetrics } from './interaction-recorder.js';

export interface BlindExperienceFinding {
  findingId: string;
  type: UxIssueType;
  severity: FrictionEvent['severity'];
  affectedStep: string;
  confirmedFacts: string[];
  hypothesis: string;
  recommendation: string;
  evidence: string[];
  confidence: FrictionEvent['confidence'];
  functionalVerdict: EvalCaseResult['verdict'];
  functionalTaskPassed: boolean;
}

export interface BlindExperienceAnalysis {
  schemaVersion: 1;
  runId: string;
  caseId: string;
  personaId: string;
  goal: string;
  analysisMode: 'blind_experience_run';
  actorKnowledgeBoundary: 'goal_persona_known_information_visible_ui_only';
  oracleAutoFinish: 'disabled';
  functionalVerdict: EvalCaseResult['verdict'];
  failureSource: EvalCaseResult['failureSource'];
  agentStatus: AiTestAgentRun['status'];
  analysisStatus: 'evaluated' | 'suppressed_functional_failure' | 'insufficient_evidence';
  timingPolicy: 'captured_but_not_used_for_friction';
  routeSequence: string[];
  routeBacktrackCount: number;
  steps: AdaptiveExperienceStep[];
  actions: ReturnType<typeof analyzeAdaptiveExperience>['actions'];
  metrics: SimulatedUserMetrics;
  frictions: FrictionEvent[];
  findings: BlindExperienceFinding[];
  authenticityNotice: string[];
}

function completionFor(input: {
  result: EvalCaseResult;
  evalCase: EvalCase;
  agentStatus: AiTestAgentRun['status'];
}): CompletionDefinition {
  const passed = input.result.verdict === 'pass' && input.result.failureSource === null;
  const productFailed = input.result.verdict === 'fail' && input.result.failureSource === 'product';
  const userAbandoned = input.agentStatus === 'abandoned';
  const semanticComplete = input.result.semantic.taskCompletion === 'complete'
    ? true
    : input.result.semantic.taskCompletion === 'failed'
      ? false
      : null;
  const evidence = [...new Set([
    ...input.result.deterministic.evidenceRefs,
    ...input.result.semantic.evidenceRefs,
  ])];
  return {
    technical: {
      conditions: ['独立 Judge 已完成证据判定'],
      complete: passed ? true : productFailed ? false : null,
      evidence: input.result.deterministic.evidenceRefs,
    },
    interface: {
      conditions: ['用户可见结果状态可验证'],
      complete: semanticComplete,
      evidence: input.result.semantic.evidenceRefs,
    },
    userGoal: {
      conditions: [input.evalCase.goal],
      complete: passed ? true : productFailed || userAbandoned ? false : null,
      evidence,
    },
    followUp: {
      conditions: ['用户可明确继续、修改、重试、返回或结束'],
      complete: null,
      evidence: [],
    },
  };
}

function recommendationFor(friction: FrictionEvent): string {
  if (friction.type === 'usability_issue' && friction.observedBehavior.startsWith('交互目标冲突：')) {
    return '检查主要可点击目标与次级控件的点击热区，避免覆盖或竞争，并保证主要目标的默认点击区域能够稳定命中。';
  }
  switch (friction.type) {
    case 'repeated_input_issue':
      return '检查字段默认值、输入保留和校验说明，减少同一信息的重复录入。';
    case 'path_efficiency_issue':
    case 'discoverability_issue':
      return '检查核心入口的命名、层级和主次视觉关系，让首次用户更容易识别与当前目标最相关的操作。';
    case 'interaction_feedback_issue':
      return '为操作增加立即可见且与结果一致的状态反馈，避免用户通过重复点击确认是否生效。';
    case 'journey_breakpoint':
    case 'recovery_issue':
      return '为当前状态提供清晰、安全的继续、修改、重试或返回路径，并验证用户可以恢复任务。';
    case 'abandonment_risk':
      return '定位放弃前的最后几个可见状态，降低无效尝试成本并补充明确的恢复或下一步入口。';
    default:
      return '结合对应步骤截图、页面状态与操作轨迹复核信息层级和反馈，再做最小范围的交互修改。';
  }
}

function findingsFrom(input: {
  frictions: FrictionEvent[];
  result: EvalCaseResult;
}): BlindExperienceFinding[] {
  const functionalTaskPassed = input.result.verdict === 'pass' && input.result.failureSource === null;
  return input.frictions.map((friction, index) => ({
    findingId: `blind-experience-${friction.featureId}-${index + 1}`,
    type: friction.type,
    severity: friction.severity,
    affectedStep: friction.step,
    confirmedFacts: [friction.observedBehavior],
    hypothesis: friction.possibleUserReason,
    recommendation: recommendationFor(friction),
    evidence: friction.evidence,
    confidence: friction.confidence,
    functionalVerdict: input.result.verdict,
    functionalTaskPassed,
  }));
}

export function analyzeBlindExperience(input: {
  evalCase: EvalCase;
  result: EvalCaseResult;
  packet: EvidencePacket;
  agentRun: Pick<AiTestAgentRun, 'status' | 'decisions'>;
}): BlindExperienceAnalysis {
  const normalized = analyzeAdaptiveExperience({
    evalCase: input.evalCase,
    result: input.result,
    packet: input.packet,
    decisions: input.agentRun.decisions,
  });
  const completion = completionFor({
    result: input.result,
    evalCase: input.evalCase,
    agentStatus: input.agentRun.status,
  });
  const abandoned = normalized.actions.some((action) => action.type === 'abandon');
  const baseMetrics = calculateInteractionMetrics(normalized.actions, {
    completion,
    requiredActionIds: [],
    redundantActionIds: [],
    abandoned,
    abandonmentReason: abandoned ? 'Blind Actor 在目标被独立 Judge 证明完成前明确选择放弃' : null,
  });
  const metrics = simulatedUserMetricsSchema.parse({
    ...baseMetrics,
    pageTransitions: Math.max(0, normalized.routeSequence.length - 1),
    backtrackCount: normalized.routeBacktrackCount,
  });

  const confirmedProductFailure = input.result.verdict === 'fail' && input.result.failureSource === 'product';
  const evaluatorFailure = input.result.failureSource === 'evaluator';
  const unknownFailure = input.result.verdict === 'fail' && input.result.failureSource === 'unknown';
  const hasBehaviorEvidence = normalized.steps.length > 0 && (normalized.actions.length > 0 || input.agentRun.status === 'completed');
  const analysisStatus: BlindExperienceAnalysis['analysisStatus'] = confirmedProductFailure
    ? 'suppressed_functional_failure'
    : evaluatorFailure || unknownFailure || !hasBehaviorEvidence
      ? 'insufficient_evidence'
      : 'evaluated';

  const deterministicExecutionFrictions = detectDeterministicExecutionFrictions({
    featureId: input.evalCase.capabilityId,
    personaId: input.evalCase.persona.personaId,
    packet: input.packet,
    decisions: input.agentRun.decisions,
  });

  const frictions = confirmedProductFailure
    ? []
    : analysisStatus === 'evaluated'
      ? [
        ...deterministicExecutionFrictions,
        ...detectFrictions({
          featureId: input.evalCase.capabilityId,
          personaId: input.evalCase.persona.personaId,
          actions: normalized.actions,
          metrics,
          completion,
        }),
      ]
      : deterministicExecutionFrictions;

  return {
    schemaVersion: 1,
    runId: input.packet.runId,
    caseId: input.evalCase.caseId,
    personaId: input.evalCase.persona.personaId,
    goal: input.evalCase.goal,
    analysisMode: 'blind_experience_run',
    actorKnowledgeBoundary: 'goal_persona_known_information_visible_ui_only',
    oracleAutoFinish: 'disabled',
    functionalVerdict: input.result.verdict,
    failureSource: input.result.failureSource,
    agentStatus: input.agentRun.status,
    analysisStatus,
    timingPolicy: 'captured_but_not_used_for_friction',
    routeSequence: normalized.routeSequence,
    routeBacktrackCount: normalized.routeBacktrackCount,
    steps: normalized.steps,
    actions: normalized.actions,
    metrics,
    frictions,
    findings: findingsFrom({ frictions, result: input.result }),
    authenticityNotice: [
      '这是 AI Blind Actor 的可观察行为证据，不等同于真实用户情绪、满意度或真实流量数据。',
      'Blind Actor 只接收 persona、goal、known information 和当前可见 UI；真实 Oracle 仅由独立 Judge 使用。',
      'wall-clock 模型/API 延迟被记录但不用于推断用户犹豫。',
      confirmedProductFailure
        ? '独立 Judge 已确认 Product Failure，因此本轮 UX Finding 被抑制，避免把 Bug 包装成体验建议。'
        : evaluatorFailure || unknownFailure
          ? '终局证据仍不足；仅保留中断前由浏览器确定性证明的交互目标冲突，不据此把 provider/evaluator interruption 改判为 Product Failure。'
          : '即使功能 Judge 未能确认 PASS，只要不存在确认的 Product/Evaluator Failure，Blind Actor 的回退、重试、无反馈和放弃仍可形成体验证据。',
    ],
  };
}
