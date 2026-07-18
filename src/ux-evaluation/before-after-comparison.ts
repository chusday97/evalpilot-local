import type { BeforeAfterComparison, JourneyComparison, UxIssue } from '../../types.js';
import { beforeAfterComparisonSchema } from '../schemas/ux-evaluation.js';

export interface BeforeAfterInput {
  issue: Pick<UxIssue, 'issueId' | 'protectedSafetySteps' | 'evidence'>;
  before: JourneyComparison;
  after: JourneyComparison;
  safetyConstraintsPreserved: boolean;
  newIssueIds: string[];
  now?: () => Date;
}

function verdict(input: BeforeAfterInput): BeforeAfterComparison['verdict'] {
  if (!input.before.evidence.length || !input.after.evidence.length) return 'needs_human_review';
  if (!input.safetyConstraintsPreserved || input.newIssueIds.length > 0) return 'regressed';
  if (input.before.taskCompleted && !input.after.taskCompleted) return 'regressed';
  if (input.before.fullLoopCompleted && !input.after.fullLoopCompleted) return 'regressed';
  if (input.after.extraActionCount > input.before.extraActionCount || input.after.backtrackCount > input.before.backtrackCount || input.after.deadEndCount > input.before.deadEndCount) return 'regressed';
  if ((!input.before.taskCompleted && input.after.taskCompleted)
    || (!input.before.fullLoopCompleted && input.after.fullLoopCompleted)
    || input.after.extraActionCount < input.before.extraActionCount
    || input.after.backtrackCount < input.before.backtrackCount
    || input.after.repeatedInputCount < input.before.repeatedInputCount
    || input.after.deadEndCount < input.before.deadEndCount) return 'improved';
  return 'unchanged';
}

export function buildBeforeAfterComparison(input: BeforeAfterInput): BeforeAfterComparison {
  const comparisonId = `comparison-${input.issue.issueId}-${input.before.runId}-${input.after.runId}`.replace(/[^a-zA-Z0-9._-]/g, '-');
  return beforeAfterComparisonSchema.parse({
    comparisonId,
    issueId: input.issue.issueId,
    beforeRunId: input.before.runId,
    afterRunId: input.after.runId,
    before: input.before,
    after: input.after,
    safetyConstraintsPreserved: input.safetyConstraintsPreserved,
    newIssueIds: input.newIssueIds,
    verdict: verdict(input),
    evidence: [...new Set([...input.issue.evidence, ...input.before.evidence, ...input.after.evidence])],
    comparedAt: (input.now ?? (() => new Date()))().toISOString(),
  });
}
