import { resolve } from 'node:path';
import { configuredEvaluationProvider } from '../src/evaluation/evaluation-orchestrator.js';
import { runConnectedModelCalibration } from '../src/ux-evaluation/connected-model-calibration.js';
import { ensureDirectory, writeJsonAtomic } from '../src/utils/file-system.js';

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const outputRoot = resolve(argValue('--output') ?? '.evalpilot-calibration');
const allowScreenshotToProvider = process.argv.includes('--allow-screenshot');
const maxStepsValue = argValue('--max-steps');
const maxSteps = maxStepsValue ? Number.parseInt(maxStepsValue, 10) : undefined;

if (maxSteps !== undefined && (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 12)) {
  throw new Error('--max-steps must be an integer between 1 and 12.');
}

const provider = configuredEvaluationProvider();
await ensureDirectory(outputRoot);
const result = await runConnectedModelCalibration({
  provider,
  outputDir: outputRoot,
  allowScreenshotToProvider,
  maxSteps,
});
const artifactPath = resolve(outputRoot, 'connected-model-calibration.json');
await writeJsonAtomic(artifactPath, result);

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify({ artifactPath, ...result }, null, 2)}\n`);
} else {
  const { metrics } = result;
  process.stdout.write([
    'Connected-model behavior sensitivity completed.',
    `Provider: ${result.provider.providerId} / ${result.provider.model}`,
    `Signal preservation recall: ${metrics.signalPreservationRecall.toFixed(3)}`,
    `Precision vs probe ground truth: ${metrics.precisionAgainstProbeGroundTruth.toFixed(3)}`,
    `Exact signal match rate: ${metrics.exactSignalMatchRate.toFixed(3)}`,
    `Clean actor drift rate: ${metrics.cleanActorDriftRate.toFixed(3)}`,
    `Provider/evaluator failures: ${metrics.providerFailureCount}`,
    `Artifact: ${artifactPath}`,
    '',
    'Boundary: this is a connected-model sensitivity probe, not general UX accuracy or a human usability study.',
  ].join('\n'));
}
