export type { EvaluationNextAction, EvaluationNextActionCta, EvaluationNextActionType } from '../../types.js';

import type { Badcase, CandidateFinding, EvalCase, EvalCaseResult, EvidencePacket, FixTask, WorkflowStatus } from '../../types.js';

export interface EvaluationDecisionInput {
  evaluationId: string;
  evaluationStatus: WorkflowStatus;
  selectedCases: EvalCase[];
  results: EvalCaseResult[];
  findings: CandidateFinding[];
  badcases: Badcase[];
  fixTasks: FixTask[];
  evidencePackets: EvidencePacket[];
}
