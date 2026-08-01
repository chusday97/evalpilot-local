import type { EvalCase } from '../../types.js';
import { loadEvalSetCases } from './eval-set-store.js';

export async function loadRegressionCases(outputDir: string): Promise<EvalCase[]> {
  return (await loadEvalSetCases(outputDir)).filter((item) => item.setType === 'regression' && item.status !== 'retired');
}
