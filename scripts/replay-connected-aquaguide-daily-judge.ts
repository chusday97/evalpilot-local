import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { ZodType } from 'zod';
import type { AiStructuredRequest } from '../types.js';
import { AiProviderError, type AiProvider } from '../src/ai/provider.js';
import { aiConnectionStatus } from '../src/ai/provider-connection.js';
import { configuredEvaluationProvider } from '../src/evaluation/evaluation-orchestrator.js';
import { runSemanticJudge } from '../src/judge/semantic-judge.js';
import { mergeJudgeVerdicts } from '../src/judge/verdict-merger.js';
import { evidencePacketSchema } from '../src/test-agent/schemas.js';
import {
  connectedAquaGuideDailyReplayCase,
  connectedAquaGuideDailyReplayTargetCommit,
  prepareConnectedAquaGuideDailyJudgeReplay,
} from '../src/validation/connected-aquaguide-daily-judge-replay.js';

const confirmationToken = 'RUN_CONNECTED_AQUAGUIDE_DAILY_JUDGE_REPLAY';

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required argument: ${name}`);
}

const evidencePacketPath = resolve(arg('--evidence-packet'));
const expectedTargetCommit = arg('--expected-target', connectedAquaGuideDailyReplayTargetCommit);
const outputPath = resolve(arg('--output', 'connected-aquaguide-daily-judge-replay.json'));
const preflightOnly = process.argv.includes('--preflight');
const packet = evidencePacketSchema.parse(JSON.parse(await readFile(evidencePacketPath, 'utf8')));
const prepared = prepareConnectedAquaGuideDailyJudgeReplay({ packet, expectedTargetCommit });
const connection = aiConnectionStatus();
const canRun = connection.configured && connection.provider === 'deepseek';

const base = {
  schemaVersion: 1,
  sourceRunId: prepared.sourceRunId,
  sourceCaseId: prepared.sourceCaseId,
  sourceEvidencePacket: evidencePacketPath,
  targetAppGitSha: prepared.targetAppGitSha,
  deterministic: prepared.deterministic,
  semanticPromptBytes: prepared.promptBytes,
  provider: connection,
  claimBoundary: [
    'This replay reuses retained Run evidence and does not execute the product or Actor again.',
    'The replay can re-evaluate the Judge verdict for the retained evidence; it cannot prove a fresh product navigation run passed.',
    'Preflight makes zero remote provider calls.',
    'Screenshots are not sent to the provider; semantic Judge receives the same visible-text evidence shape as normal evaluation.',
    'Provider failure remains separate from product and evaluator-runtime failure.',
  ],
};

if (preflightOnly) {
  const preflight = {
    ...base,
    analysisMode: 'connected_aquaguide_daily_judge_replay_preflight',
    status: canRun ? 'ready' : 'blocked',
    canRun,
    remoteCallsMade: false,
  };
  process.stdout.write(`${JSON.stringify(preflight, null, 2)}\n`);
  process.exitCode = canRun ? 0 : 2;
} else {
  if (arg('--confirm', '') !== confirmationToken) {
    throw new Error(`Remote Judge replay was not authorized. Pass --confirm ${confirmationToken} exactly.`);
  }
  if (!canRun) throw new Error('Connected Judge replay requires a configured DeepSeek provider.');

  const providerFailure = { value: false };
  const delegate = configuredEvaluationProvider();
  if (delegate.info.providerId !== 'deepseek') {
    throw new Error(`Connected Judge replay requires DeepSeek; received ${delegate.info.providerId}.`);
  }

  const auditedProvider: AiProvider = {
    info: delegate.info,
    async generateStructured<T>(request: AiStructuredRequest, schema: ZodType<T>): Promise<T> {
      try {
        return await delegate.generateStructured(request, schema);
      } catch (error) {
        if (error instanceof AiProviderError) providerFailure.value = true;
        throw error;
      }
    },
  };

  const semanticOutcome = await runSemanticJudge({
    provider: auditedProvider,
    evalCase: connectedAquaGuideDailyReplayCase,
    packet,
    deterministic: prepared.deterministic,
    allowRemoteModel: true,
  });
  const merged = mergeJudgeVerdicts({
    evalCase: connectedAquaGuideDailyReplayCase,
    packet,
    deterministic: prepared.deterministic,
    semantic: semanticOutcome.result,
    semanticEvaluatorFailed: semanticOutcome.evaluatorFailed,
  });
  const runtimeFailureSource = providerFailure.value
    ? 'provider'
    : semanticOutcome.evaluatorFailed ? 'evaluator' : null;
  const replay = {
    ...base,
    analysisMode: 'connected_aquaguide_daily_judge_replay',
    remoteCallsMade: true,
    runtimeFailureSource,
    semanticEvaluatorFailed: semanticOutcome.evaluatorFailed,
    semanticError: semanticOutcome.error,
    semantic: semanticOutcome.result,
    mergedResult: merged,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(replay, null, 2));
  process.stdout.write(`${JSON.stringify(replay, null, 2)}\n`);
  process.exitCode = runtimeFailureSource === null ? 0 : 2;
}
