import type {
  CompletionDefinition,
  FrictionEvent,
  FunctionalRunStatus,
  SimulatedUserMetrics,
  UxDimension,
  UxDimensionScore,
  UxEvaluationResult,
  UxIssue,
} from '../../types.js';
import { uxEvaluationResultSchema } from '../schemas/ux-evaluation.js';

const dimensions: UxDimension[] = [
  'discoverability', 'comprehension', 'convenience', 'interactionFeedback', 'userControl', 'errorRecovery',
  'journeyNaturalness', 'systemTransparency', 'interruptionTolerance', 'accessibility', 'goalCompletion', 'followUpClarity',
];

const frictionDimensions: Partial<Record<FrictionEvent['type'], UxDimension[]>> = {
  discoverability_issue: ['discoverability'],
  usability_issue: ['convenience', 'userControl'],
  path_efficiency_issue: ['convenience', 'journeyNaturalness'],
  repeated_input_issue: ['convenience', 'journeyNaturalness'],
  content_clarity_issue: ['comprehension', 'systemTransparency'],
  interaction_feedback_issue: ['interactionFeedback'],
  recovery_issue: ['errorRecovery', 'interruptionTolerance'],
  trust_issue: ['systemTransparency'],
  accessibility_issue: ['accessibility'],
  journey_breakpoint: ['goalCompletion', 'followUpClarity'],
  abandonment_risk: ['journeyNaturalness', 'goalCompletion'],
  functional_bug: ['goalCompletion'],
};

export interface GradeUxInput {
  runId: string;
  functionalStatus: FunctionalRunStatus;
  completion: CompletionDefinition;
  metrics: SimulatedUserMetrics;
  frictions: FrictionEvent[];
  directEvidence: string[];
}

function scores(input: GradeUxInput): UxDimensionScore[] {
  return dimensions.map((dimension) => {
    const related = input.frictions.filter((friction) => frictionDimensions[friction.type]?.includes(dimension));
    let score: 0 | 1 | 2 = related.some((friction) => friction.severity === 'P0' || friction.severity === 'P1') ? 0 : related.length ? 1 : 2;
    if (dimension === 'goalCompletion' && input.completion.userGoal.complete !== true) score = 0;
    if (dimension === 'followUpClarity' && input.completion.followUp.complete !== true) score = 0;
    if (dimension === 'errorRecovery' && input.metrics.errorCount > 0 && !input.metrics.recoverySuccess) score = input.metrics.recoveryAttempts > 0 ? 1 : 0;
    const evidence = [...new Set([...input.directEvidence, ...related.flatMap((friction) => friction.evidence)])];
    const confidence = evidence.length > 1 ? 'high' : evidence.length === 1 ? 'medium' : 'low';
    return { dimension, score, evidence, confidence, needsHumanReview: confidence === 'low' };
  });
}

export function gradeUx(input: GradeUxInput): UxEvaluationResult {
  const uxScores = scores(input);
  const fullLoop = input.completion.userGoal.complete === true && input.completion.followUp.complete === true;
  const verdict = input.functionalStatus === 'failed'
    ? 'functional_failed'
    : input.functionalStatus === 'blocked'
      ? 'needs_human_review'
      : !fullLoop
        ? 'full_loop_failed'
        : uxScores.some((item) => item.score === 0)
          ? 'functional_passed_ux_failed'
          : uxScores.some((item) => item.score === 1)
            ? 'friction_non_blocking'
            : uxScores.some((item) => item.needsHumanReview)
              ? 'needs_human_review'
              : 'functional_and_ux_passed';
  return uxEvaluationResultSchema.parse({
    runId: input.runId,
    completion: input.completion,
    functionalStatus: input.functionalStatus,
    uxScores,
    verdict,
    authenticityNotice: [
      '本报告使用模拟用户运行指标和工程证据，不代表真实用户满意度、留存、转化或市场需求。',
      '可能原因属于推测；低置信度结论必须人工审核。',
    ],
  });
}

export function buildUxIssue(
  evaluation: UxEvaluationResult,
  friction: FrictionEvent,
  input: Omit<UxIssue, 'issueId' | 'type' | 'severity' | 'confidence' | 'needsHumanReview'>,
): UxIssue {
  return {
    ...input,
    issueId: `issue-ux-${friction.frictionId}`,
    type: friction.type,
    severity: friction.severity,
    confidence: friction.confidence,
    needsHumanReview: friction.confidence === 'low' || evaluation.verdict === 'needs_human_review',
  };
}

export function renderUxReport(evaluation: UxEvaluationResult, issues: UxIssue[]): string {
  const scoresText = evaluation.uxScores.map((item) => `- ${item.dimension}：${item.score}/2（${item.confidence}）`).join('\n');
  return `# EvalPilot Local 用户体验报告\n\n` +
    `## 结论\n\n- 功能状态：${evaluation.functionalStatus}\n- UX 判定：${evaluation.verdict}\n` +
    `- 技术完成：${evaluation.completion.technical.complete === true ? '是' : '否/待确认'}\n` +
    `- 用户目标完成：${evaluation.completion.userGoal.complete === true ? '是' : '否/待确认'}\n` +
    `- 完整闭环：${evaluation.completion.userGoal.complete === true && evaluation.completion.followUp.complete === true ? '是' : '否'}\n\n` +
    `## UX 分项\n\n${scoresText}\n\n## 用户视角问题\n\n` +
    `${issues.length ? issues.map((issue) => `### ${issue.type}\n\n- Issue ID：${issue.issueId}\n- 用户目标：${issue.userGoal}\n- 实际路径：${issue.actualPath.join(' → ')}\n- 理想路径：${issue.idealPath.join(' → ')}\n- 最短合理路径：${issue.shortestReasonablePath.join(' → ')}\n- 建议：${issue.recommendation}\n- 置信度：${issue.confidence}\n`).join('\n') : '本轮没有生成已证实的 UX 问题。'}\n` +
    `\n## 真实性声明\n\n${evaluation.authenticityNotice.map((item) => `- ${item}`).join('\n')}\n`;
}
