import type { BenchmarkReport } from '../../types.js';
import { benchmarkReportSchema } from '../eval-set/schemas.js';
import { evaluateBenchmarkFixture } from './evaluator.js';
import { builtinBenchmarkFixtures } from './fixtures.js';
import { calculateBenchmarkMetrics } from './metrics.js';

export function runBuiltinBenchmark(generatedAt = new Date().toISOString()): BenchmarkReport {
  const fixtures = builtinBenchmarkFixtures();
  const predictions = fixtures.map(evaluateBenchmarkFixture);
  return benchmarkReportSchema.parse({
    benchmarkVersion: '1.0.0', generatedAt, metrics: calculateBenchmarkMetrics(fixtures, predictions), predictions,
    limitation: '本报告只验证内置直接证据信号与分类规则；它不调用远程模型，也不证明 EvalPilot 在任意真实产品上都可靠。',
  });
}
