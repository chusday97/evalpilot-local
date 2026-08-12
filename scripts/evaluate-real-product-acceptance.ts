import { resolve } from 'node:path';
import { evaluateRealProductAcceptanceFromArtifacts } from '../src/acceptance/real-product-acceptance.js';

function valueAfter(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const manifestPath = valueAfter('--manifest');
const evaluationDirectory = valueAfter('--evaluation-dir');
const json = process.argv.includes('--json');

if (!manifestPath || !evaluationDirectory) {
  process.stderr.write('Usage: npm run acceptance:gate -- --manifest <manifest.yaml> --evaluation-dir <evaluation-directory> [--json]\n');
  process.exitCode = 2;
} else {
  const gate = await evaluateRealProductAcceptanceFromArtifacts({
    manifestPath: resolve(manifestPath),
    evaluationDirectory: resolve(evaluationDirectory),
  });

  if (json) {
    process.stdout.write(`${JSON.stringify(gate, null, 2)}\n`);
  } else {
    const percent = `${Math.round(gate.taskCompletionRate * 100)}%`;
    process.stdout.write([
      `Real Product Acceptance — ${gate.product}`,
      `Source: ${gate.repository}@${gate.commit.slice(0, 12)}`,
      `Task Completion Rate: ${gate.counts.passed}/${gate.counts.planned} (${percent})`,
      ...gate.tasks.map((task) => `- [${task.status}] ${task.name}${task.caseId ? ` (${task.caseId})` : ''}: ${task.reason}`),
      `Gate: ${gate.passed ? 'PASS' : 'FAIL'}`,
      ...(gate.failedThresholds.length ? [`Failed thresholds: ${gate.failedThresholds.join(' | ')}`] : []),
    ].join('\n') + '\n');
  }

  if (!gate.passed) process.exitCode = 1;
}
