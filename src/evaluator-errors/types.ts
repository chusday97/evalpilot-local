export type { EvaluatorBadcase, EvaluatorFailureCategory } from '../../types.js';

export interface EvaluatorFailureClassification {
  category: import('../../types.js').EvaluatorFailureCategory;
  technicalReason: string;
}
