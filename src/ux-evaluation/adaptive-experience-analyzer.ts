import type {
  AgentDecision,
  CompletionDefinition,
  EvalCase,
  EvalCaseResult,
  EvidencePacket,
  FrictionEvent,
  InteractionAction,
  PageObservation,
  SimulatedUserMetrics,
  UxIssueType,
} from '../../types.js';
import { simulatedUserMetricsSchema } from '../schemas/ux-evaluation.js';
import { detectFrictions } from './friction-detector.js';
import { calculateInteractionMetrics, fingerprintInput } from './interaction-recorder.js';

export interface AdaptiveExperienceStep {
  stepIndex: number;
  decisionId: string;
  action: AgentDecision['action'];
  pageBefore: string;
  pageAfter: string;
  target: string | null;
  actorConfidence: number;
  verificationStatus: 'confirmed' | 'not_confirmed' | 'inconclusive';
  taskState: string | null;
  observableProgress: boolean;
  evidence: string[];
}

export interface AdaptiveExperienceFinding {
  findingId: string;
  type: UxIssueType;
  severity: FrictionEvent['severity'];
  affectedStep: string;
  confirmedFacts: string[];
  hypothesis: string;
  recommendation: string;
  evidence: string[];
  confidence: FrictionEvent['confidence'];
  functionalTaskPassed: true;
}

export interface AdaptiveExperienceAnalysis {
  schemaVersion: 1;
  runId: string;
  caseId: string;
  personaId: string;
  goal: string;
  analysisMode: 'functional_run_sidecar';
  actorKnowledgeBoundary: 'goal_persona_visible_ui_only';
  functionalVerdict: EvalCaseResult['verdict'];
  analysisStatus: 'evaluated' | 'suppressed_functional_failure' | 'insufficient_evidence';
  timingPolicy: 'captured_but_not_used_for_friction';
  routeSequence: string[];
  routeBacktrackCount: number;
  steps: AdaptiveExperienceStep[];
  actions: InteractionAction[];
  metrics: SimulatedUserMetrics;
  frictions: FrictionEvent[];
  findings: AdaptiveExperienceFinding[];
  authenticityNotice: string[];
}

function normalized(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function observationSignature(observation: PageObservation): string {
  const fields = observation.formFields
    .slice(0, 20)
    .map((field) => `${field.elementId}:${field.currentValuePresent}:${field.disabled}`)
    .join('|');
  const controls = observation.interactableElements
    .slice(0, 30)
    .map((element) => `${element.tagName}:${normalized(element.label)}:${element.disabled}`)
    .join('|');
  return `${observation.pageUrl}::${normalized(observation.visibleStateSummary).slice(0, 2_000)}::${fields}::${controls}`;
}

function targetLabel(observation: PageObservation, decision: AgentDecision): string | null {
  if (!decision.targetElementId) return null;
  const element = observation.interactableElements.find((item) => item.elementId === decision.targetElementId);
  return element?.label || element?.text || element?.placeholder || decision.targetElementId;
}

function completionFor(result: EvalCaseResult, evalCase: EvalCase): CompletionDefinition {
  const passed = result.verdict === 'pass' && result.failureSource === null;
  const productFailed = result.verdict === 'fail' && result.failureSource === 'product';
  const evidence = [...new Set([...result.deterministic.evidenceRefs, ...result.semantic.evidenceRefs])];
  const semanticComplete = result.semantic.taskCompletion === 'complete'
    ? true
    : result.semantic.taskCompletion === 'failed'
      ? false
      : null;
  return {
    technical: { conditions: ['功能评测器完成判定'], complete: passed ? true : productFailed ? false : null, evidence: result.deterministic.evidenceRefs },
    interface: { conditions: ['用户可见结果状态可验证'], complete: semanticComplete, evidence: result.semantic.evidenceRefs },
    userGoal: { conditions: [evalCase.goal], complete: passed ? true : productFailed ? false : null, evidence },
    // Adaptive functional cases currently do not prove the separate post-result loop. Keep it
    // unknown instead of fabricating a missing-next-step UX issue.
    followUp: { conditions: ['用户可明确继续、修改、保存或结束'], complete: null, evidence: [] },
  };
}

function hasObservableProgress(input: {
  before: PageObservation;
  after: PageObservation;
  verificationStatus: AdaptiveExperienceStep['verificationStatus'];
  taskState: string | null;
  progressSignals: string[];
}): boolean {
  if (input.verificationStatus === 'confirmed') return true;
  if (['pending', 'progressing', 'completed'].includes(input.taskState ?? '')) return true;
  if (input.progressSignals.length > 0) return true;
  if (input.before.pageUrl !== input.after.pageUrl) return true;
  return observationSignature(input.before) !== observationSignature(input.after);
}

function hasSafeActionableElement(observation: PageObservation): boolean {
  return observation.interactableElements.some((element) => !element.disabled && element.risk === 'safe')
    || observation.formFields.some((field) => !field.disabled && field.risk === 'safe');
}

function interactionType(decision: AgentDecision, actionStatus: string, observableProgress: boolean): InteractionAction['type'] | null {
  if (actionStatus === 'failed') return 'error';
  if (decision.action === 'fill' || decision.action === 'select') return 'input';
  if (decision.action === 'click') return 'click';
  if (decision.action === 'back') return 'backtrack';
  if (decision.action === 'retry') return 'retry';
  if (decision.action === 'abandon') return 'abandon';
  if (decision.action === 'wait' && !observableProgress) return 'hesitation';
  if (decision.action === 'finish' || decision.action === 'wait') return null;
  return 'navigation';
}

function routeSequenceFromSteps(steps: AdaptiveExperienceStep[]): string[] {
  const sequence: string[] = [];
  for (const step of steps) {
    if (sequence.at(-1) !== step.pageBefore) sequence.push(step.pageBefore);
    if (sequence.at(-1) !== step.pageAfter) sequence.push(step.pageAfter);
  }
  return sequence;
}

function recommendationFor(type: UxIssueType): string {
  switch (type) {
    case 'repeated_input_issue':
      return '检查字段默认值、输入保留和校验说明，避免用户重复录入已经提供的信息。';
    case 'path_efficiency_issue':
    case 'discoverability_issue':
      return '检查核心入口的命名、层级和主次视觉关系，让与当前目标最相关的操作更容易被首次用户识别。';
    case 'interaction_feedback_issue':
      return '为操作增加立即可见且与结果一致的状态反馈，避免用户通过重复点击来确认是否生效。';
    case 'journey_breakpoint':
    case 'recovery_issue':
      return '为当前状态提供清晰、安全的继续、修改、重试或返回路径，并验证用户可以恢复任务。';
    case 'abandonment_risk':
      return '减少该步骤的失败循环或信息要求，并提供明确恢复路径，避免超过 Persona 的耐心边界。';
    default:
      return '结合对应步骤截图和操作轨迹复核信息层级、反馈与下一步可发现性，再做最小范围的交互修改。';
  }
}

function findingsFrom(frictions: FrictionEvent[]): AdaptiveExperienceFinding[] {
  return frictions.map((friction, index) => ({
    findingId: `experience-${friction.featureId}-${index + 1}`,
    type: friction.type,
    severity: friction.severity,
    affectedStep: friction.step,
    confirmedFacts: [friction.observedBehavior],
    hypothesis: friction.possibleUserReason,
    recommendation: recommendationFor(friction.type),
    evidence: friction.evidence,
    confidence: friction.confidence,
    functionalTaskPassed: true as const,
  }));
}

export function analyzeAdaptiveExperience(input: {
  evalCase: EvalCase;
  result: EvalCaseResult;
  packet: EvidencePacket;
  decisions: AgentDecision[];
}): AdaptiveExperienceAnalysis {
  const observations = new Map(input.packet.observations.map((item) => [item.observationId, item]));
  const verifications = new Map(input.packet.stepVerifications.map((item) => [item.verificationId, item]));
  const decisions = new Map(input.decisions.filter((item) => item.decisionId).map((item) => [item.decisionId!, item]));
  const steps: AdaptiveExperienceStep[] = [];
  const rawActions: InteractionAction[] = [];

  for (const stepEvidence of input.packet.stepEvidence) {
    const decision = decisions.get(stepEvidence.decisionId) ?? input.decisions[stepEvidence.stepIndex - 1];
    const before = observations.get(stepEvidence.beforeObservationId);
    const after = observations.get(stepEvidence.afterObservationId);
    const verification = verifications.get(stepEvidence.verificationId);
    if (!decision || !before || !after || !verification) continue;
    const taskState = stepEvidence.taskState?.state ?? null;
    const progressSignals = stepEvidence.taskState?.progressSignals ?? [];
    const observableProgress = hasObservableProgress({
      before,
      after,
      verificationStatus: verification.status,
      taskState,
      progressSignals,
    });
    const evidence = [...new Set([
      stepEvidence.beforeScreenshotPath,
      stepEvidence.afterScreenshotPath,
      ...verification.evidenceRefs,
    ])];
    const step: AdaptiveExperienceStep = {
      stepIndex: stepEvidence.stepIndex,
      decisionId: stepEvidence.decisionId,
      action: decision.action,
      pageBefore: before.pageUrl,
      pageAfter: after.pageUrl,
      target: targetLabel(before, decision),
      actorConfidence: decision.confidence,
      verificationStatus: verification.status,
      taskState,
      observableProgress,
      evidence,
    };
    steps.push(step);

    const type = interactionType(decision, stepEvidence.actionStatus, observableProgress);
    if (!type) continue;
    const packetAction = input.packet.actions[stepEvidence.stepIndex - 1];
    const isInput = type === 'input';
    const noFeedback = type === 'click' && stepEvidence.actionStatus === 'executed' && !observableProgress;
    const deadEndAbandon = type === 'abandon' && !hasSafeActionableElement(before);
    rawActions.push({
      actionId: packetAction?.actionId ?? `experience-action-${String(stepEvidence.stepIndex).padStart(3, '0')}`,
      type,
      timestampMs: packetAction?.timestampMs ?? stepEvidence.stepIndex,
      page: before.pageUrl,
      target: targetLabel(before, decision),
      // Repeated-input identity must come from the grounded field identity, not its visible
      // label. Distinct unlabeled dimension fields may all render as “input”; treating that
      // shared label as identity creates false repeated-input findings (e.g. 60×30×30).
      inputField: isInput ? decision.targetElementId : null,
      inputLength: isInput ? decision.value?.length ?? 0 : null,
      inputFingerprint: isInput && decision.value ? fingerprintInput(decision.value) : null,
      outcome: stepEvidence.actionStatus === 'failed'
        ? 'action_failed'
        : deadEndAbandon
          ? 'dead_end_abandon'
          : noFeedback
            ? 'no_feedback'
            : observableProgress
              ? 'observable_feedback'
              : 'no_progress',
      evidence,
    });
  }

  const completion = completionFor(input.result, input.evalCase);
  // This analyzer is currently attached to the functional task run. If the objective Judge
  // proves the user goal complete and the scripted/task Actor then emits a terminal abandon,
  // that final decision is a termination artifact, not part of the pre-completion UX path.
  // Preserve it in `steps` for auditability but exclude it from normalized UX actions/metrics.
  const actions = completion.userGoal.complete === true && rawActions.at(-1)?.type === 'abandon'
    ? rawActions.slice(0, -1)
    : rawActions;
  const abandoned = actions.some((action) => action.type === 'abandon');
  const baseMetrics = calculateInteractionMetrics(actions, {
    completion,
    requiredActionIds: [],
    redundantActionIds: [],
    abandoned,
    abandonmentReason: abandoned ? '模拟用户在目标完成前明确选择放弃当前路径' : null,
  });
  const routeSequence = routeSequenceFromSteps(steps);
  // A URL round-trip is not itself a user backtrack: opening a setup sub-route/modal and
  // returning after Save is a normal successful path. Count only an explicit Actor back
  // action as behavioral backtracking. Route history remains available as evidence.
  const routeBacktrackCount = actions.filter((action) => action.type === 'backtrack').length;
  const metrics = simulatedUserMetricsSchema.parse({
    ...baseMetrics,
    pageTransitions: Math.max(0, routeSequence.length - 1),
    backtrackCount: routeBacktrackCount,
  });

  const functionalPassed = input.result.verdict === 'pass' && input.result.failureSource === null;
  const productFailed = input.result.verdict === 'fail' && input.result.failureSource === 'product';
  const analysisStatus: AdaptiveExperienceAnalysis['analysisStatus'] = functionalPassed
    ? 'evaluated'
    : productFailed
      ? 'suppressed_functional_failure'
      : 'insufficient_evidence';
  const frictions = functionalPassed
    ? detectFrictions({
      featureId: input.evalCase.capabilityId,
      personaId: input.evalCase.persona.personaId,
      actions,
      metrics,
      completion,
    })
    : [];

  return {
    schemaVersion: 1,
    runId: input.packet.runId,
    caseId: input.evalCase.caseId,
    personaId: input.evalCase.persona.personaId,
    goal: input.evalCase.goal,
    analysisMode: 'functional_run_sidecar',
    actorKnowledgeBoundary: 'goal_persona_visible_ui_only',
    functionalVerdict: input.result.verdict,
    analysisStatus,
    timingPolicy: 'captured_but_not_used_for_friction',
    routeSequence,
    routeBacktrackCount,
    steps,
    actions,
    metrics,
    frictions,
    findings: functionalPassed ? findingsFrom(frictions) : [],
    authenticityNotice: [
      '这是 AI 模拟用户的可观察交互摩擦，不等同于真实用户情绪或满意度。',
      '当前是 functional_run_sidecar：Actor Prompt 不接收 Oracle 答案，但功能运行仍可能使用 evaluator-side 完成控制；因此它不是独立的真实模型可用性研究。',
      'Friction 只使用操作、页面状态、验证结果和证据引用；wall-clock 模型延迟不用于判断用户犹豫。',
      '功能已证实完成后的终止动作保留在 raw Step evidence 中，但不计入 UX actions/metrics。',
      'URL 往返本身不视为回退；只有 Actor 明确执行 back 才计入 backtrack。不同字段使用 grounded element identity 区分，避免同名/无标签字段造成重复输入误报。',
      '当目标尚未完成、Actor 明确放弃且当前页面没有 enabled + safe 的可交互控件时，证据重建会保留 dead_end 结果；这用于区分普通放弃与无恢复出口的旅程断点。',
      productFailed
        ? '本轮存在已确认产品功能失败，因此 UX Friction 被抑制，避免把 Bug 包装成体验建议。'
        : '功能通过后仍允许保留非阻塞 UX Friction，用于发现“能完成但不好用”的路径。',
    ],
  };
}
