import type { AiProvider } from '../ai/provider.js';
import type { AgentDecision, EvalCase, PageObservation, StepVerification } from '../../types.js';
import { actorPromptV1 } from '../prompts/actor.v1.js';
import { agentDecisionSchema } from './schemas.js';
import type { RuntimeTaskProgress } from './task-progress.js';

function immediateOracleSatisfied(evalCase: EvalCase, observation: PageObservation): boolean {
  const assertions = evalCase.oracle.deterministicAssertions;
  if (assertions.length === 0) return false;
  const text = observation.visibleStateSummary.toLowerCase();
  return assertions.every((assertion) => {
    if (assertion.type === 'url_matches') {
      const matched = observation.pageUrl.includes(assertion.target);
      return matched !== assertion.negated;
    }
    if (assertion.type === 'text_visible' || assertion.type === 'text_absent') {
      const present = text.includes(assertion.target.toLowerCase());
      const expectedPresent = assertion.type === 'text_visible' ? !assertion.negated : assertion.negated;
      return present === expectedPresent;
    }
    // Request/console/persistence assertions require Evidence Packet state that the Actor
    // does not own. Never auto-finish a task when those assertions are present.
    return false;
  });
}

const commitControlPattern = /(?:^|\b)(?:save(?:\s+settings)?|submit|apply|confirm|create|record|add(?:\s+to\s+.+)?)(?:\b|$)|保存(?:设置|到鱼缸)?|提交|应用|确认|创建|记录|添加/u;
const commitTaskPattern = /\b(?:save|submit|create|record|add|update|persist)\b|保存|提交|创建|建立|记录|添加|更新|持久化/u;

function taskRequiresCommit(evalCase: EvalCase): boolean {
  // Actor-side execution policy may use the user's stated task, but never hidden Oracle
  // outcomes. Hidden success strings belong to the Judge/evaluator boundary only.
  const taskText = [evalCase.title, evalCase.goal].filter(Boolean).join(' ').toLowerCase();
  return commitTaskPattern.test(taskText);
}

function hasPendingCommitControl(observation: PageObservation): boolean {
  return observation.interactableElements.some((element) => {
    if (element.disabled || element.risk !== 'safe') return false;
    if (element.tagName !== 'button' && element.role !== 'button') return false;
    const label = `${element.label ?? ''} ${element.text ?? ''}`.trim().toLowerCase();
    return label.length > 0 && commitControlPattern.test(label);
  });
}

function hasVerifiedExecutedProgress(history: AgentDecision[], verifications: StepVerification[]): boolean {
  if (history.length === 0 || verifications.length === 0) return false;
  return verifications.some((verification) => verification.status === 'confirmed');
}

export async function chooseAgentAction(input: {
  provider: AiProvider;
  evalCase: EvalCase;
  observation: PageObservation;
  history: AgentDecision[];
  verifications: StepVerification[];
  progress: RuntimeTaskProgress;
  screenshotDataUrl: string | null;
  allowRemoteModel: boolean;
  allowScreenshot: boolean;
  /** Functional task runs may use a hidden evaluator-side auto-finish optimization.
   * Blind UX/exploration runs must set this false so the simulated user has to recognize
   * completion from visible evidence itself. */
  allowOracleAutoFinish?: boolean;
}): Promise<AgentDecision> {
  // Do not declare a task complete from its initial page alone: examples, placeholders or
  // pre-existing state can already contain the Oracle text. Auto-finish is only a recovery
  // optimization after this run has produced at least one confirmed interaction.
  //
  // Mutation tasks must also finish their visible Save/Submit step. Read-only/result tasks
  // may expose an optional follow-up Save button after their actual goal is already proven;
  // that optional persistence affordance must not block deterministic completion.
  //
  // Crucially, this branch is evaluator-side control flow. It is disabled for blind UX runs
  // and none of the Oracle values are serialized into the Actor prompt.
  const pendingRequiredCommit = taskRequiresCommit(input.evalCase) && hasPendingCommitControl(input.observation);
  if (input.allowOracleAutoFinish !== false
    && hasVerifiedExecutedProgress(input.history, input.verifications)
    && !pendingRequiredCommit
    && immediateOracleSatisfied(input.evalCase, input.observation)) {
    return agentDecisionSchema.parse({
      intentSummary: '当前页面已经满足全部可即时验证的确定性成功条件。',
      action: 'finish',
      targetElementId: null,
      value: null,
      expectedResult: input.evalCase.oracle.deterministicAssertions.map((assertion) => assertion.target).join('；'),
      confidence: 1,
    });
  }

  const prompt = actorPromptV1.build(input);
  return input.provider.generateStructured({
    requestId: `actor-${input.history.length + 1}`,
    task: 'actor',
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    schemaName: 'agent_decision',
    imageDataUrls: input.allowScreenshot && input.screenshotDataUrl ? [input.screenshotDataUrl] : [],
    privacy: { allowRemoteModel: input.allowRemoteModel, allowScreenshot: input.allowScreenshot, visibleTextOnly: true, redactionApplied: true },
    metadata: { caseId: input.evalCase.caseId, promptVersion: actorPromptV1.version },
  }, agentDecisionSchema);
}
