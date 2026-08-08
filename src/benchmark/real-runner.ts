import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import type { BadcaseCategory, BenchmarkIssue, RealBenchmarkFixtureResult, RealBenchmarkReport, RealBenchmarkRunResult } from '../../types.js';
import { runAdaptiveCase } from '../evaluation/adaptive-evaluation-service.js';
import { realBenchmarkFixtureResultSchema, realBenchmarkReportSchema, realBenchmarkRunResultSchema } from '../eval-set/schemas.js';
import { writeSchemaJsonAtomic } from '../utils/schema-file.js';
import { calculateRealBenchmarkMetrics } from './real-metrics.js';
import { createRealBenchmarkProvider } from './real-mock-provider.js';
import { loadRealBenchmarkGroundTruth, realBenchmarkAppRoot, realBenchmarkEvalCase, realBenchmarkFixtureDefinitions, realBenchmarkProductModel } from './real-fixtures.js';

async function startFixtureServer() {
  let duplicateRequests = 0;
  const root = realBenchmarkAppRoot();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/api/fail') { response.writeHead(500, { 'content-type': 'text/plain' }); response.end('fixture failure'); return; }
      if (url.pathname === '/api/duplicate') { duplicateRequests += 1; const status = duplicateRequests === 1 ? 200 : 409; response.writeHead(status, { 'content-type': 'text/plain' }); response.end(status === 200 ? 'accepted' : 'duplicate'); return; }
      const match = url.pathname.match(/^\/apps\/([a-z0-9-]+)\/?$/);
      if (!match) { response.writeHead(404); response.end('not found'); return; }
      const html = await readFile(join(root, match[1]!, 'index.html'));
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); response.end(html);
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain' }); response.end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise<void>((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolveListen()); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('真实基准夹具服务没有获得本地端口。');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    reset: () => { duplicateRequests = 0; },
    close: () => { server.closeAllConnections(); return new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())); },
  };
}

function predictionFrom(outcome: Awaited<ReturnType<typeof runAdaptiveCase>>, fixtureId: string): BenchmarkIssue[] {
  if (!outcome.badcase) return [];
  return [{ issueId: `issue-real-${fixtureId}-${outcome.result.runId}`, category: outcome.badcase.category as BadcaseCategory, severity: outcome.badcase.severity, summary: outcome.badcase.title }];
}

function consistentRuns(runs: RealBenchmarkRunResult[]): boolean {
  const signatures = runs.map((run) => JSON.stringify({ verdict: run.verdict, failureSource: run.failureSource, issues: run.predictedIssues.map((issue) => [issue.category, issue.severity]).sort() }));
  return new Set(signatures).size === 1;
}

function reliabilityGate(metrics: RealBenchmarkReport['metrics']): RealBenchmarkReport['reliabilityGate'] {
  const reasons = [
    metrics.bugDetectionRecall < 0.8 ? `Recall ${metrics.bugDetectionRecall.toFixed(2)} < 0.80` : null,
    metrics.precision < 0.8 ? `Precision ${metrics.precision.toFixed(2)} < 0.80` : null,
    metrics.falsePositiveRate > 0.15 ? `FPR ${metrics.falsePositiveRate.toFixed(2)} > 0.15` : null,
    metrics.failureSourceAccuracy < 0.85 ? `Failure Source Accuracy ${metrics.failureSourceAccuracy.toFixed(2)} < 0.85` : null,
  ].filter((reason): reason is string => Boolean(reason));
  return { met: reasons.length === 0, internalOnly: true, reasons };
}

export async function runRealEvaluatorBenchmark(options: { outputDir: string; repetitions?: number; generatedAt?: string }): Promise<RealBenchmarkReport> {
  const repetitions = options.repetitions ?? 3;
  if (repetitions < 3) throw new Error('真实评测器基准每个夹具至少需要运行 3 次。');
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const fixtureServer = await startFixtureServer();
  const fixtureResults: RealBenchmarkFixtureResult[] = [];
  try {
    for (const [fixtureIndex, definition] of realBenchmarkFixtureDefinitions.entries()) {
      const browser = await chromium.launch({ headless: true });
      const runs: RealBenchmarkRunResult[] = [];
      const evalCase = realBenchmarkEvalCase(definition, generatedAt);
      const model = realBenchmarkProductModel(definition, generatedAt);
      const outputDir = resolve(options.outputDir, definition.fixtureId);
      try {
        for (let repetition = 1; repetition <= repetitions; repetition += 1) {
          fixtureServer.reset();
          const context = await browser.newContext();
          const page = await context.newPage();
          const startingUrl = `${fixtureServer.baseUrl}/apps/${definition.fixtureId}`;
          const provider = createRealBenchmarkProvider(definition.providerMode);
          const runAt = new Date(Date.parse(generatedAt) + (fixtureIndex * repetitions + repetition) * 1_000);
          try {
            await page.goto(startingUrl, { waitUntil: 'domcontentloaded' });
            const outcome = await runAdaptiveCase({ page, provider, outputDir, evalCase, productModel: model, existingCases: [evalCase], startingUrl, evalSetVersion: 1, maxAgentSteps: 3, agentWaitTimeoutMs: 1_000, now: () => runAt, allowRemoteModel: false });
            runs.push(realBenchmarkRunResultSchema.parse({ fixtureId: definition.fixtureId, repetition, runId: outcome.result.runId, agentStatus: outcome.agentRun.status, verdict: outcome.result.verdict, failureSource: outcome.result.failureSource, predictedIssues: predictionFrom(outcome, definition.fixtureId), taskCompleted: outcome.agentRun.status === 'completed' && outcome.result.verdict === 'pass', inconclusive: outcome.result.verdict === 'inconclusive' }));
          } finally { await context.close(); }
        }
      } finally { await browser.close(); }
      const groundTruth = await loadRealBenchmarkGroundTruth(definition.fixtureId);
      fixtureResults.push(realBenchmarkFixtureResultSchema.parse({ groundTruth, runs, consistent: consistentRuns(runs) }));
    }
  } finally {
    await fixtureServer.close();
  }
  const metrics = calculateRealBenchmarkMetrics(fixtureResults);
  const report = realBenchmarkReportSchema.parse({ benchmarkVersion: '2.0.0-real-browser', generatedAt, protocol: { actorMode: 'deterministic_mock', repetitions, browser: 'chromium' }, metrics, fixtureResults, reliabilityGate: reliabilityGate(metrics), limitation: '该结果使用确定性 Mock Actor 隔离 Judge 与 Triage，只代表这 10 个本地 Chromium 夹具；不代表真实模型或真实世界可靠性。' });
  await writeSchemaJsonAtomic(resolve(options.outputDir, 'real-benchmark-report.json'), report, realBenchmarkReportSchema);
  return report;
}
