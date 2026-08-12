export type { EvaluationNextAction, EvaluationNextActionCta, EvaluationNextActionType } from '../../types.js';

import type { Badcase, CandidateFinding, EvalCase, EvalCaseResult, EvidencePacket, FixTask, WorkflowStatus } from '../../types.js';

export type EvaluationPrerequisiteType = 'needs_auth' | 'needs_setup' | 'needs_test_data' | 'needs_human_input' | 'unsupported';

export interface EvaluationPrerequisiteBlocker {
  caseId: string;
  type: EvaluationPrerequisiteType;
  summary: string;
  sourceValue: string;
  reasons: string[];
}

export interface EvaluationDecisionInput {
  evaluationId: string;
  evaluationStatus: WorkflowStatus;
  selectedCases: EvalCase[];
  results: EvalCaseResult[];
  findings: CandidateFinding[];
  badcases: Badcase[];
  fixTasks: FixTask[];
  evidencePackets: EvidencePacket[];
  prerequisiteBlockers?: EvaluationPrerequisiteBlocker[];
}
