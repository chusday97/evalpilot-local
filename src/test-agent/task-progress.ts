import type { EvalCase, PageObservation, StepVerification, TaskStateObservation } from '../../types.js';

export interface RuntimeTaskProgress {
  currentFocus: 'complete_required_inputs' | 'trigger_or_continue_task' | 'verify_completion';
  currentFocusLabel: string;
  completedVerifiedSteps: number;
  remainingExpectedSignals: string[];
  remainingActionBudget: number;
  currentActionBudget: number;
  hardActionBudget: number;
  failedAttempts: number;
}

export interface ActionBudgetState {
  current: number;
  hard: number;
  extensions: number;
}

export function initialActionBudget(explicitMaxSteps?: number): ActionBudgetState {
  if (explicitMaxSteps !== undefined) {
    const bounded = Math.max(1, Math.floor(explicitMaxSteps));
    return { current: bounded, hard: bounded, extensions: 0 };
  }
  return { current: 8, hard: 20, extensions: 0 };
}

function expectedSignals(evalCase: EvalCase): string[] {
  return [...new Set([...evalCase.oracle.mustObserve, ...evalCase.oracle.expectedOutcome].map((value) => value.trim()).filter(Boolean))].slice(0, 8);
}

function signalVisible(observation: PageObservation, signal: string): boolean {
  return observation.visibleStateSummary.toLocaleLowerCase().includes(signal.toLocaleLowerCase());
}

export function runtimeTaskProgress(input: {
  evalCase: EvalCase;
  observation: PageObservation;
  verifications: StepVerification[];
  budget: ActionBudgetState;
  currentStep: number;
  failedAttempts: number;
}): RuntimeTaskProgress {
  const remainingExpectedSignals = expectedSignals(input.evalCase).filter((signal) => !signalVisible(input.observation, signal));
  const emptyRequiredFields = input.observation.formFields.filter((field) => field.required && !field.currentValuePresent && !field.disabled && field.risk === 'safe');
  const currentFocus = emptyRequiredFields.length
    ? 'complete_required_inputs'
    : remainingExpectedSignals.length
      ? 'trigger_or_continue_task'
      : 'verify_completion';
  const currentFocusLabel = currentFocus === 'complete_required_inputs'
    ? `先完成 ${emptyRequiredFields.length} 个仍为空的必填安全字段。`
    : currentFocus === 'trigger_or_continue_task'
      ? '继续当前用户任务，优先选择能推进目标且尚未验证的安全操作。'
      : '目标结果线索已经可见；只在证据足够时结束，否则继续验证。';
  return {
    currentFocus,
    currentFocusLabel,
    completedVerifiedSteps: input.verifications.filter((verification) => verification.status === 'confirmed').length,
    remainingExpectedSignals,
    remainingActionBudget: Math.max(0, input.budget.current - input.currentStep),
    currentActionBudget: input.budget.current,
    hardActionBudget: input.budget.hard,
    failedAttempts: input.failedAttempts,
  };
}

export function maybeExtendActionBudget(input: {
  budget: ActionBudgetState;
  stepIndex: number;
  taskState: TaskStateObservation;
  verification: StepVerification;
}): ActionBudgetState {
  if (input.budget.current >= input.budget.hard) return input.budget;
  if (input.stepIndex < input.budget.current - 1) return input.budget;
  const madeProgress = input.verification.status === 'confirmed'
    || input.taskState.state === 'completed'
    || input.taskState.state === 'progressing';
  if (!madeProgress) return input.budget;
  return {
    current: Math.min(input.budget.hard, input.budget.current + 3),
    hard: input.budget.hard,
    extensions: input.budget.extensions + 1,
  };
}

export function pageStateFingerprint(observation: PageObservation): string {
  const elements = observation.interactableElements.slice(0, 20).map((element) => `${element.tagName}:${element.label}:${element.disabled}`).join('|');
  const areas = observation.primaryAreas.slice(0, 6).join('|');
  return `${observation.pageUrl}::${areas}::${elements}::${observation.visibleStateSummary.slice(0, 500)}`;
}

export function repeatedStateCount(history: string[], nextFingerprint: string): number {
  let count = 1;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index] !== nextFingerprint) break;
    count += 1;
  }
  return count;
}
