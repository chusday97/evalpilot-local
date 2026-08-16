import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXPECTED_RUNS = 3;
const EXPECTED_ANALYSIS_MODE = 'connected_aquaguide_blind_smoke';
const COHORT_ANALYSIS_MODE = 'connected_aquaguide_3_run_variance_cohort';

type CountMap = Record<string, number>;

export interface ConnectedSmokeTaskResult {
  caseId: string;
  executionStatus: string;
  verdict: string | null;
  failureSource: string | null;
  runtimeFailureSource: string | null;
  agentStatus: string | null;
  actionSequence: string[];
  actionCount: number;
  backtrackCount: number;
  retryCount: number;
  repeatedInputCount: number;
  frictionTypes: string[];
  findingTypes: string[];
  observedPreFailureSignals: Array<{ type?: string; cause?: string }>;
}

export interface ConnectedSmokeDiagnostic {
  analysisMode: string;
  targetAppGitSha: string;
  provider: { providerId: string; model: string };
  executionConfig: {
    maxAgentSteps: number;
    allowScreenshotToProvider: boolean;
    sequentialSharedBrowserContext: boolean;
    prerequisiteCascadeGuard: boolean;
    preFailureSignalSidecar: boolean;
    benchmarkLocale: string;
    applicationLocale: string;
  };
  caseIds: string[];
  protocolHealthy: boolean;
  allBlind: boolean;
  actorOracleLeakCount: number;
  judgeOracleVisible: boolean;
  providerFailureCount: number;
  evaluatorFailureCount: number;
  unknownFailureCount: number;
  blockedPrerequisiteCount: number;
  observedPreFailureSignalCount: number;
  allProductJourneysPassed: boolean;
  taskResults: ConnectedSmokeTaskResult[];
}

export interface CohortCaseSummary {
  caseId: string;
  runCount: number;
  completedPassCount: number;
  completionRate: number;
  verdictCounts: CountMap;
  executionStatusCounts: CountMap;
  runtimeFailureCounts: CountMap;
  outcomeStable: boolean;
  distinctOutcomeCount: number;
  actionPathStable: boolean;
  distinctActionPathCount: number;
  actionPathCounts: CountMap;
  actionCount: { min: number; max: number; mean: number };
  backtrackRunCount: number;
  actorRetryRunCount: number;
  repeatedInputRunCount: number;
  frictionRecurrence: CountMap;
  findingRecurrence: CountMap;
  preFailureSignalRecurrence: CountMap;
}

export interface ConnectedAquaGuideCohortSummary {
  schemaVersion: 1;
  analysisMode: typeof COHORT_ANALYSIS_MODE;
  generatedAt: string;
  runCount: number;
  cohortComplete: boolean;
  configuration: {
    targetAppGitSha: string;
    providerId: string;
    model: string;
    maxAgentSteps: number;
    allowScreenshotToProvider: boolean;
    benchmarkLocale: string;
    applicationLocale: string;
    caseIds: string[];
  };
  boundaryHealthy: boolean;
  protocolHealthyRunCount: number;
  fullPassRunCount: number;
  providerFailureRunCount: number;
  evaluatorFailureRunCount: number;
  unknownFailureRunCount: number;
  blockedPrerequisiteRunCount: number;
  actorOracleLeakTotal: number;
  judgeOracleVisibleAll: boolean;
  observedPreFailureSignalRunCount: number;
  cases: CohortCaseSummary[];
  claimBoundary: string[];
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function count(values: string[]): CountMap {
  const output: CountMap = {};
  for (const value of values) output[value] = (output[value] ?? 0) + 1;
  return output;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(3));
}

function uniqueRunTypes(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function signalKey(signal: { type?: string; cause?: string }): string {
  const type = signal.type?.trim() || 'unknown_signal';
  const cause = signal.cause?.trim();
  return cause ? `${type}:${cause}` : type;
}

function recurrenceByRun(taskResults: ConnectedSmokeTaskResult[], selector: (task: ConnectedSmokeTaskResult) => string[]): CountMap {
  const result: CountMap = {};
  for (const task of taskResults) {
    for (const item of uniqueRunTypes(selector(task))) result[item] = (result[item] ?? 0) + 1;
  }
  return result;
}

function normalizeTask(task: ConnectedSmokeTaskResult): ConnectedSmokeTaskResult {
  return {
    ...task,
    actionSequence: Array.isArray(task.actionSequence) ? task.actionSequence.map(String) : [],
    frictionTypes: Array.isArray(task.frictionTypes) ? task.frictionTypes.map(String) : [],
    findingTypes: Array.isArray(task.findingTypes) ? task.findingTypes.map(String) : [],
    observedPreFailureSignals: Array.isArray(task.observedPreFailureSignals) ? task.observedPreFailureSignals : [],
    actionCount: Number(task.actionCount ?? 0),
    backtrackCount: Number(task.backtrackCount ?? 0),
    retryCount: Number(task.retryCount ?? 0),
    repeatedInputCount: Number(task.repeatedInputCount ?? 0),
  };
}

function validateSmoke(run: ConnectedSmokeDiagnostic, index: number): void {
  ensure(run && typeof run === 'object', `Run ${index + 1} is not an object.`);
  ensure(run.analysisMode === EXPECTED_ANALYSIS_MODE, `Run ${index + 1} is not a connected AquaGuide Blind Smoke.`);
  ensure(typeof run.targetAppGitSha === 'string' && run.targetAppGitSha.length > 0, `Run ${index + 1} is missing targetAppGitSha.`);
  ensure(run.provider?.providerId && run.provider?.model, `Run ${index + 1} is missing provider identity.`);
  ensure(Array.isArray(run.caseIds) && run.caseIds.length > 0, `Run ${index + 1} is missing caseIds.`);
  ensure(Array.isArray(run.taskResults), `Run ${index + 1} is missing taskResults.`);
  ensure(run.taskResults.length === run.caseIds.length, `Run ${index + 1} taskResults do not match caseIds.`);
}

function configFingerprint(run: ConnectedSmokeDiagnostic): string {
  return JSON.stringify({
    targetAppGitSha: run.targetAppGitSha,
    providerId: run.provider.providerId,
    model: run.provider.model,
    maxAgentSteps: run.executionConfig.maxAgentSteps,
    allowScreenshotToProvider: run.executionConfig.allowScreenshotToProvider,
    benchmarkLocale: run.executionConfig.benchmarkLocale,
    applicationLocale: run.executionConfig.applicationLocale,
    caseIds: run.caseIds,
  });
}

export function aggregateConnectedAquaGuideCohort(runs: ConnectedSmokeDiagnostic[]): ConnectedAquaGuideCohortSummary {
  ensure(runs.length === EXPECTED_RUNS, `Connected AquaGuide cohort requires exactly ${EXPECTED_RUNS} runs; received ${runs.length}.`);
  runs.forEach(validateSmoke);

  const first = runs[0]!;
  const fingerprint = configFingerprint(first);
  for (let index = 1; index < runs.length; index += 1) {
    ensure(configFingerprint(runs[index]!) === fingerprint, `Run ${index + 1} configuration drifted from run 1.`);
  }

  const cases: CohortCaseSummary[] = first.caseIds.map((caseId) => {
    const tasks = runs.map((run, runIndex) => {
      const task = run.taskResults.find((candidate) => candidate.caseId === caseId);
      ensure(task, `Run ${runIndex + 1} is missing case ${caseId}.`);
      return normalizeTask(task);
    });

    const completedPassCount = tasks.filter((task) => (
      task.executionStatus === 'executed'
      && task.verdict === 'pass'
      && task.failureSource === null
      && task.runtimeFailureSource === null
      && task.agentStatus === 'completed'
    )).length;
    const outcomeKeys = tasks.map((task) => `${task.executionStatus}:${task.verdict ?? 'n/a'}:${task.runtimeFailureSource ?? 'none'}`);
    const executedPaths = tasks
      .filter((task) => task.executionStatus === 'executed')
      .map((task) => task.actionSequence.length ? task.actionSequence.join('>') : '(no-actions)');
    const actionCounts = tasks.filter((task) => task.executionStatus === 'executed').map((task) => task.actionCount);

    return {
      caseId,
      runCount: tasks.length,
      completedPassCount,
      completionRate: Number((completedPassCount / tasks.length).toFixed(3)),
      verdictCounts: count(tasks.map((task) => task.verdict ?? 'n/a')),
      executionStatusCounts: count(tasks.map((task) => task.executionStatus)),
      runtimeFailureCounts: count(tasks.map((task) => task.runtimeFailureSource ?? 'none')),
      outcomeStable: new Set(outcomeKeys).size === 1,
      distinctOutcomeCount: new Set(outcomeKeys).size,
      actionPathStable: new Set(executedPaths).size <= 1,
      distinctActionPathCount: new Set(executedPaths).size,
      actionPathCounts: count(executedPaths),
      actionCount: {
        min: actionCounts.length ? Math.min(...actionCounts) : 0,
        max: actionCounts.length ? Math.max(...actionCounts) : 0,
        mean: mean(actionCounts),
      },
      backtrackRunCount: tasks.filter((task) => task.backtrackCount > 0).length,
      actorRetryRunCount: tasks.filter((task) => task.retryCount > 0).length,
      repeatedInputRunCount: tasks.filter((task) => task.repeatedInputCount > 0).length,
      frictionRecurrence: recurrenceByRun(tasks, (task) => task.frictionTypes),
      findingRecurrence: recurrenceByRun(tasks, (task) => task.findingTypes),
      preFailureSignalRecurrence: recurrenceByRun(tasks, (task) => task.observedPreFailureSignals.map(signalKey)),
    };
  });

  return {
    schemaVersion: 1,
    analysisMode: COHORT_ANALYSIS_MODE,
    generatedAt: new Date().toISOString(),
    runCount: runs.length,
    cohortComplete: true,
    configuration: {
      targetAppGitSha: first.targetAppGitSha,
      providerId: first.provider.providerId,
      model: first.provider.model,
      maxAgentSteps: first.executionConfig.maxAgentSteps,
      allowScreenshotToProvider: first.executionConfig.allowScreenshotToProvider,
      benchmarkLocale: first.executionConfig.benchmarkLocale,
      applicationLocale: first.executionConfig.applicationLocale,
      caseIds: [...first.caseIds],
    },
    boundaryHealthy: runs.every((run) => run.allBlind === true && run.actorOracleLeakCount === 0 && run.judgeOracleVisible === true),
    protocolHealthyRunCount: runs.filter((run) => run.protocolHealthy === true).length,
    fullPassRunCount: runs.filter((run) => run.allProductJourneysPassed === true).length,
    providerFailureRunCount: runs.filter((run) => run.providerFailureCount > 0).length,
    evaluatorFailureRunCount: runs.filter((run) => run.evaluatorFailureCount > 0).length,
    unknownFailureRunCount: runs.filter((run) => run.unknownFailureCount > 0).length,
    blockedPrerequisiteRunCount: runs.filter((run) => run.blockedPrerequisiteCount > 0).length,
    actorOracleLeakTotal: runs.reduce((total, run) => total + run.actorOracleLeakCount, 0),
    judgeOracleVisibleAll: runs.every((run) => run.judgeOracleVisible === true),
    observedPreFailureSignalRunCount: runs.filter((run) => run.observedPreFailureSignalCount > 0).length,
    cases,
    claimBoundary: [
      'This cohort contains exactly three same-configuration connected runs; frequencies are descriptive observations, not true probabilities.',
      'Product verdicts, provider failures, evaluator failures, prerequisite blockers, action-path variance, and UX findings remain separate dimensions.',
      'A finding or pre-failure signal recurring in three runs increases recurrence evidence but does not by itself prove human-user impact.',
      'Provider retry attempts are not visible in current smoke diagnostics; providerFailureRunCount measures terminal provider failures only.',
      'The cohort is invalid if target commit, model, max steps, locale contract, screenshot policy, or case order drifts between runs.',
    ],
  };
}

function mapToInline(map: CountMap): string {
  const entries = Object.entries(map);
  return entries.length ? entries.map(([key, value]) => `${key}=${value}`).join(', ') : 'none';
}

export function renderConnectedAquaGuideCohortMarkdown(summary: ConnectedAquaGuideCohortSummary): string {
  const lines = [
    '# Connected AquaGuide 3-Run Variance Cohort',
    '',
    `- Runs: ${summary.runCount}`,
    `- Target: \`${summary.configuration.targetAppGitSha}\``,
    `- Provider: ${summary.configuration.providerId} / ${summary.configuration.model}`,
    `- Locale: ${summary.configuration.benchmarkLocale} / ${summary.configuration.applicationLocale}`,
    `- Boundary healthy: ${summary.boundaryHealthy ? 'yes' : 'no'}`,
    `- Protocol-healthy runs: ${summary.protocolHealthyRunCount}/${summary.runCount}`,
    `- Full-product-pass runs: ${summary.fullPassRunCount}/${summary.runCount}`,
    `- Provider failure runs: ${summary.providerFailureRunCount}/${summary.runCount}`,
    `- Evaluator failure runs: ${summary.evaluatorFailureRunCount}/${summary.runCount}`,
    `- Prerequisite-blocked runs: ${summary.blockedPrerequisiteRunCount}/${summary.runCount}`,
    '',
    '| Journey | Completion | Outcome stable | Distinct paths | Actions min/mean/max | Backtrack runs | Pre-failure recurrence |',
    '|---|---:|---|---:|---:|---:|---|',
    ...summary.cases.map((item) => `| ${item.caseId} | ${item.completedPassCount}/${item.runCount} | ${item.outcomeStable ? 'yes' : 'no'} | ${item.distinctActionPathCount} | ${item.actionCount.min}/${item.actionCount.mean}/${item.actionCount.max} | ${item.backtrackRunCount} | ${mapToInline(item.preFailureSignalRecurrence)} |`),
    '',
    '## Per-journey recurrence',
    '',
    ...summary.cases.flatMap((item) => [
      `### ${item.caseId}`,
      `- Verdicts: ${mapToInline(item.verdictCounts)}`,
      `- Runtime failures: ${mapToInline(item.runtimeFailureCounts)}`,
      `- Action paths: ${mapToInline(item.actionPathCounts)}`,
      `- Frictions by run: ${mapToInline(item.frictionRecurrence)}`,
      `- Findings by run: ${mapToInline(item.findingRecurrence)}`,
      `- Pre-failure signals by run: ${mapToInline(item.preFailureSignalRecurrence)}`,
      '',
    ]),
    '## Claim boundary',
    '',
    ...summary.claimBoundary.map((item) => `- ${item}`),
    '',
  ];
  return lines.join('\n');
}

function argValues(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) values.push(process.argv[index + 1]!);
  }
  return values;
}

function arg(name: string, fallback?: string): string {
  const values = argValues(name);
  if (values[0]) return values[0];
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required argument: ${name}`);
}

async function main(): Promise<void> {
  const inputPaths = argValues('--input').map((item) => resolve(item));
  ensure(inputPaths.length === EXPECTED_RUNS, `Pass exactly ${EXPECTED_RUNS} --input files.`);
  const outputPath = resolve(arg('--output', 'connected-aquaguide-cohort-summary.json'));
  const markdownPath = resolve(arg('--markdown', 'connected-aquaguide-cohort-summary.md'));
  const runs = await Promise.all(inputPaths.map(async (path) => JSON.parse(await readFile(path, 'utf8')) as ConnectedSmokeDiagnostic));
  const summary = aggregateConnectedAquaGuideCohort(runs);
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(markdownPath, `${renderConnectedAquaGuideCohortMarkdown(summary)}\n`);
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  else process.stdout.write(`Connected AquaGuide cohort: full-pass=${summary.fullPassRunCount}/${summary.runCount}; protocol-healthy=${summary.protocolHealthyRunCount}/${summary.runCount}; provider-failure-runs=${summary.providerFailureRunCount}; evaluator-failure-runs=${summary.evaluatorFailureRunCount}.\n`);
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entry) await main();
