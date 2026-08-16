import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { collectObservedPreFailureSignals } from '../src/test-agent/action-execution-signals.js';

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required argument: ${name}`);
}

interface SmokeTaskResult {
  runId?: string | null;
  observedPreFailureSignals?: unknown[];
  [key: string]: unknown;
}

interface ConnectedSmokeResult {
  schemaVersion: number;
  analysisMode: string;
  diagnosticPath?: string;
  taskResults: SmokeTaskResult[];
  claimBoundary?: string[];
  [key: string]: unknown;
}

const resultPath = resolve(arg('--result', 'connected-aquaguide-result.json'));
const outputDir = resolve(arg('--output', 'connected-aquaguide-blind-output'));
const result = JSON.parse(await readFile(resultPath, 'utf8')) as ConnectedSmokeResult;

if (result.analysisMode !== 'connected_aquaguide_blind_smoke') {
  throw new Error('Refusing to enrich a file that is not a connected AquaGuide Blind Smoke result.');
}

let preFailureSignalCount = 0;
for (const taskResult of result.taskResults) {
  if (!taskResult.runId) {
    taskResult.observedPreFailureSignals = [];
    continue;
  }

  const agentRunPath = resolve(outputDir, 'runs', String(taskResult.runId), 'agent-run.json');
  const agentRun = JSON.parse(await readFile(agentRunPath, 'utf8')) as { actionResults?: Array<{
    status: string;
    action: string;
    targetElementId: string | null;
    summary: string;
    evidenceRefs: string[];
  }> };
  const signals = collectObservedPreFailureSignals(agentRun.actionResults ?? []);
  taskResult.observedPreFailureSignals = signals;
  preFailureSignalCount += signals.length;
}

result.schemaVersion = Math.max(3, Number(result.schemaVersion) || 0);
result.preFailureSignalCount = preFailureSignalCount;
result.claimBoundary = [
  ...(result.claimBoundary ?? []),
  'observedPreFailureSignals preserves deterministic failed browser actions that occurred before a terminal provider/evaluator interruption; these signals do not independently change the journey verdict or runtimeFailureSource.',
];

const serialized = `${JSON.stringify(result, null, 2)}\n`;
await writeFile(resultPath, serialized);

if (result.diagnosticPath) {
  const diagnosticPath = resolve(String(result.diagnosticPath));
  const diagnostic = { ...result };
  delete diagnostic.diagnosticPath;
  await writeFile(diagnosticPath, `${JSON.stringify(diagnostic, null, 2)}\n`);
}

process.stdout.write(JSON.stringify({
  resultPath,
  schemaVersion: result.schemaVersion,
  preFailureSignalCount,
  taskSignalCounts: result.taskResults.map((task) => ({
    caseId: task.caseId,
    count: Array.isArray(task.observedPreFailureSignals) ? task.observedPreFailureSignals.length : 0,
  })),
}, null, 2));
process.stdout.write('\n');
