import { resolve } from 'node:path';
import { aiConnectionStatus } from '../src/ai/provider-connection.js';
import { configuredEvaluationProvider } from '../src/evaluation/evaluation-orchestrator.js';
import {
  connectedModelCalibrationProbes,
  runConnectedModelCalibration,
  type ConnectedModelCalibrationResult,
} from '../src/ux-evaluation/connected-model-calibration.js';
import { buildConnectedModelCalibrationPreflight } from '../src/ux-evaluation/connected-model-preflight.js';
import { summarizeConnectedModelCalibrationVariance } from '../src/ux-evaluation/connected-model-variance.js';
import { ensureDirectory, writeJsonAtomic } from '../src/utils/file-system.js';

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function boundedInteger(name: string, raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return value;
}

function metricLine(label: string, distribution: { mean: number; min: number; max: number }): string {
  return `${label}: mean=${distribution.mean.toFixed(3)} range=${distribution.min.toFixed(3)}..${distribution.max.toFixed(3)}`;
}

async function main(): Promise<void> {
  const outputRoot = resolve(argValue('--output') ?? '.evalpilot-calibration');
  const allowScreenshotToProvider = process.argv.includes('--allow-screenshot');
  const maxSteps = boundedInteger('--max-steps', argValue('--max-steps'), 6, 1, 12);
  const runCount = boundedInteger('--runs', argValue('--runs'), 1, 1, 10);
  const jsonOutput = process.argv.includes('--json');

  if (process.argv.includes('--preflight')) {
    const preflight = buildConnectedModelCalibrationPreflight({
      connection: aiConnectionStatus(),
      outputRoot,
      runCount,
      maxSteps,
      allowScreenshotToProvider,
    });
    if (jsonOutput) {
      process.stdout.write(`${JSON.stringify(preflight, null, 2)}\n`);
    } else {
      process.stdout.write([
        `Connected-model calibration preflight: ${preflight.status.toUpperCase()}`,
        'Remote calls made: no',
        `Provider: ${preflight.provider.configured ? `${preflight.provider.providerId} / ${preflight.provider.model}` : 'not configured'}`,
        `Probe suite: v${preflight.probeSuite.version} / ${preflight.probeSuite.fingerprint}`,
        `Execution config: runs=${preflight.workload.runs}, maxSteps=${preflight.executionConfig.maxSteps}, screenshots=${preflight.executionConfig.allowScreenshotToProvider ? 'enabled' : 'disabled'}`,
        `Probe executions: ${preflight.workload.probeExecutions} (${preflight.workload.runs} × ${preflight.workload.probesPerRun})`,
        `Actor decision request upper bound: ${preflight.workload.maxActorDecisionRequests}`,
        'Additional semantic-verification requests: variable; total request count/cost is not claimed by preflight.',
        `Output root: ${preflight.artifactPlan.outputRoot}`,
        `Raw artifact pattern: ${preflight.artifactPlan.rawRunArtifactPattern}`,
        `Aggregate artifact: ${preflight.artifactPlan.aggregateArtifact}`,
        ...preflight.reasons.map((reason) => `- ${reason}`),
      ].join('\n'));
      process.stdout.write('\n');
    }
    process.exitCode = preflight.canRun ? 0 : 2;
    return;
  }

  const sessionId = new Date().toISOString().replace(/[:.]/g, '-');
  const sessionRoot = resolve(outputRoot, `connected-model-${sessionId}`);
  const provider = configuredEvaluationProvider();
  await ensureDirectory(sessionRoot);

  process.stderr.write([
    `Connected-model calibration will run ${runCount} repetition(s) × ${connectedModelCalibrationProbes.length} controlled probes.`,
    'Each probe may make multiple remote provider requests through Actor and semantic verification; exact cost depends on the configured provider/model.',
    `Screenshots to the provider: ${allowScreenshotToProvider ? 'ENABLED by explicit flag' : 'disabled (default)'}.`,
    `Max Actor steps per probe: ${maxSteps}.`,
    '',
  ].join('\n'));

  const results: ConnectedModelCalibrationResult[] = [];
  const rawRunArtifacts: Array<{ runIndex: number; path: string }> = [];
  for (let index = 0; index < runCount; index += 1) {
    const runIndex = index + 1;
    const runDirectory = resolve(sessionRoot, 'runs', `run-${String(runIndex).padStart(3, '0')}`);
    await ensureDirectory(runDirectory);
    const result = await runConnectedModelCalibration({
      provider,
      outputDir: runDirectory,
      allowScreenshotToProvider,
      maxSteps,
    });
    const rawArtifactPath = resolve(runDirectory, 'connected-model-calibration.json');
    await writeJsonAtomic(rawArtifactPath, result);
    results.push(result);
    rawRunArtifacts.push({ runIndex, path: rawArtifactPath });
  }

  const variance = summarizeConnectedModelCalibrationVariance(results);
  const artifactPath = resolve(sessionRoot, 'connected-model-variance.json');
  const aggregateArtifact = { ...variance, rawRunArtifacts };
  await writeJsonAtomic(artifactPath, aggregateArtifact);

  // Preserve the original single-run artifact name for callers that already consume it.
  let singleRunArtifactPath: string | null = null;
  if (results.length === 1) {
    singleRunArtifactPath = resolve(sessionRoot, 'connected-model-calibration.json');
    await writeJsonAtomic(singleRunArtifactPath, results[0]);
  }

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify({ artifactPath, singleRunArtifactPath, ...aggregateArtifact }, null, 2)}\n`);
  } else {
    process.stdout.write([
      'Connected-model behavior variance calibration completed.',
      `Provider: ${variance.provider.providerId} / ${variance.provider.model}`,
      `Probe suite: v${variance.probeSuite.version} / ${variance.probeSuite.fingerprint}`,
      `Execution config: maxSteps=${variance.executionConfig.maxSteps}, screenshots=${variance.executionConfig.allowScreenshotToProvider ? 'enabled' : 'disabled'}`,
      `Runs: ${variance.runCount}`,
      `Behavior-eligible probe executions: ${variance.eligibleProbeExecutionCount}/${variance.probeExecutionCount}`,
      metricLine('Signal preservation recall', variance.metricDistributions.signalPreservationRecall),
      metricLine('Precision vs probe ground truth', variance.metricDistributions.precisionAgainstProbeGroundTruth),
      metricLine('Exact signal match rate', variance.metricDistributions.exactSignalMatchRate),
      metricLine('Clean actor drift rate', variance.metricDistributions.cleanActorDriftRate),
      `Provider/evaluator failure rate: ${variance.providerFailureRate.toFixed(3)} (${variance.providerFailureCount}/${variance.probeExecutionCount})`,
      ...variance.probeStability.map((probe) => `${probe.probeId}: eligible=${probe.eligibleRunCount}/${probe.runCount} signal-exact=${probe.exactSignalMatchRate.toFixed(3)} verdict-match=${probe.verdictMatchRate.toFixed(3)} provider-failure=${probe.providerFailureRate.toFixed(3)}`),
      `Aggregate artifact: ${artifactPath}`,
      `Raw run artifacts: ${rawRunArtifacts.map((item) => item.path).join(', ')}`,
      '',
      variance.varianceNote,
      'Boundary: repeated model behavior on controlled probes is not general UX accuracy or a human usability study.',
    ].join('\n'));
  }
}

await main();
