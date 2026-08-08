import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runRealEvaluatorBenchmark } from '../src/benchmark/real-runner.js';
import { realBenchmarkReportSchema } from '../src/eval-set/schemas.js';

describe.skipIf(process.env.EVALPILOT_BROWSER_TEST !== '1')('Phase 7 real evaluator benchmark', () => {
  it('runs ten real Chromium fixture apps three times and calculates reviewable accuracy metrics', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-real-benchmark-'));
    const report = await runRealEvaluatorBenchmark({ outputDir, repetitions: 3, generatedAt: '2026-08-09T03:00:00.000Z' });
    expect(report.fixtureResults).toHaveLength(10);
    expect(report.fixtureResults.every((fixture) => fixture.runs.length === 3)).toBe(true);
    expect(report.metrics).toMatchObject({ fixtures: 10, runs: 30 });
    expect(report.metrics.bugDetectionRecall).toBeGreaterThanOrEqual(0.8);
    expect(report.metrics.precision).toBeGreaterThanOrEqual(0.8);
    expect(report.metrics.falsePositiveRate).toBeLessThanOrEqual(0.15);
    expect(report.metrics.failureSourceAccuracy).toBeGreaterThanOrEqual(0.85);
    expect(report.reliabilityGate).toMatchObject({ met: true, internalOnly: true });
    const persisted = realBenchmarkReportSchema.parse(JSON.parse(await readFile(join(outputDir, 'real-benchmark-report.json'), 'utf8')));
    expect(persisted.fixtureResults.flatMap((fixture) => fixture.runs)).toHaveLength(30);
  }, 300_000);
});
