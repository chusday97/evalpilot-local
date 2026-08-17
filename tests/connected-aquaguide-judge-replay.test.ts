import { describe, expect, it } from 'vitest';
import type { EvidencePacket } from '../types.js';
import {
  connectedAquaGuideDailyReplayTargetCommit,
  prepareConnectedAquaGuideDailyJudgeReplay,
} from '../src/validation/connected-aquaguide-daily-judge-replay.js';

const now = '2026-08-17T06:13:27.705Z';
const beforeScreenshot = 'screenshots/step-001-before.png';
const afterScreenshot = 'screenshots/step-001-after.png';

function replayPacket(overrides: Partial<EvidencePacket> = {}): EvidencePacket {
  const finalText = [
    'Daily Aquarium Check',
    'Act now',
    'Do this first',
    '立刻增加打氧或水面扰动',
    '更新今天记录',
    '已保存今天的检查记录。',
  ].join(' ');
  const packet: EvidencePacket = {
    runId: 'run-ai-2026-08-17T06-13-27-705Z',
    caseId: 'blind-daily-check-risk',
    targetAppCommit: connectedAquaGuideDailyReplayTargetCommit,
    actorModel: 'deepseek-v4-flash',
    actorPromptVersion: '1.0.0',
    startedAt: now,
    completedAt: '2026-08-17T06:18:34.000Z',
    actions: [{
      actionId: 'agent-action-001',
      type: 'navigation',
      timestampMs: 1,
      page: '/aquarium',
      target: null,
      inputField: null,
      inputLength: null,
      inputFingerprint: null,
      outcome: 'Daily Check record saved',
      evidence: [beforeScreenshot, afterScreenshot],
    }],
    observations: [
      {
        observationId: 'observation-001-before',
        pageUrl: 'http://127.0.0.1:3000/aquarium',
        pagePurpose: 'Daily Aquarium Check',
        visibleStateSummary: 'Daily Aquarium Check in progress',
        primaryAreas: ['Daily Aquarium Check'],
        visibleProblems: [],
        interactableElements: [],
        formFields: [],
        evidenceRefs: [beforeScreenshot],
        confidence: 1,
      },
      {
        observationId: 'observation-001-after',
        pageUrl: 'http://127.0.0.1:3000/aquarium',
        pagePurpose: 'Daily Check Result',
        visibleStateSummary: finalText,
        primaryAreas: ['Daily Check Result'],
        visibleProblems: [],
        interactableElements: [],
        formFields: [],
        evidenceRefs: [afterScreenshot],
        confidence: 1,
      },
    ],
    stepVerifications: [{
      verificationId: 'verification-001',
      expectation: 'Daily Check record is saved',
      observed: finalText,
      status: 'confirmed',
      evidenceRefs: [afterScreenshot],
      confidence: 1,
    }],
    stepEvidence: [{
      stepIndex: 1,
      beforeObservationId: 'observation-001-before',
      afterObservationId: 'observation-001-after',
      beforeScreenshotPath: beforeScreenshot,
      afterScreenshotPath: afterScreenshot,
      decisionId: 'decision-001',
      verificationId: 'verification-001',
      actionStatus: 'executed',
      taskState: null,
      taskWait: null,
    }],
    screenshots: [beforeScreenshot, afterScreenshot],
    tracePath: 'trace.zip',
    evidenceCompleteness: {
      complete: true,
      hasInitialObservation: true,
      hasFinalObservation: true,
      hasBeforeAfterScreenshots: true,
      hasStepVerifications: true,
      hasTrace: true,
      missing: [],
    },
    consoleEvidence: [],
    networkEvidence: [],
    finalState: { url: 'http://127.0.0.1:3000/aquarium', visibleTextSummary: finalText },
    versions: {
      targetAppGitSha: connectedAquaGuideDailyReplayTargetCommit,
      productModelVersion: 1,
      evalSetVersion: 1,
      caseVersion: 1,
      evalPilotVersion: '0.6.0-alpha.0',
      actorModel: 'deepseek-v4-flash',
      judgeModel: 'deepseek-v4-flash',
      actorPromptVersion: '1.0.0',
      judgePromptVersion: '1.0.0',
      toolSchemaVersion: '1.0.0',
      timestamp: now,
    },
  };
  return { ...packet, ...overrides };
}

describe('Connected AquaGuide Daily Judge replay', () => {
  it('prepares Run #10-style retained evidence without making a provider call', () => {
    const prepared = prepareConnectedAquaGuideDailyJudgeReplay({ packet: replayPacket() });
    expect(prepared.sourceRunId).toBe('run-ai-2026-08-17T06-13-27-705Z');
    expect(prepared.targetAppGitSha).toBe(connectedAquaGuideDailyReplayTargetCommit);
    expect(prepared.deterministic.hardFailure).toBe(false);
    expect(prepared.deterministic.checks.map(item => item.verdict)).toEqual(['pass', 'pass', 'pass']);
    expect(prepared.promptBytes.total).toBeGreaterThan(0);
    expect(prepared.promptBytes.total).toBe(prepared.promptBytes.system + prepared.promptBytes.user);
  });

  it('rejects evidence from another product commit', () => {
    const packet = replayPacket({
      targetAppCommit: '8663b469c50605529367daf1b69ac0cd7cfb0cac',
      versions: {
        ...replayPacket().versions,
        targetAppGitSha: '8663b469c50605529367daf1b69ac0cd7cfb0cac',
      },
    });
    expect(() => prepareConnectedAquaGuideDailyJudgeReplay({ packet })).toThrow(/target mismatch/);
  });

  it('rejects retained evidence that is not actually complete', () => {
    const packet = replayPacket({ tracePath: null });
    expect(() => prepareConnectedAquaGuideDailyJudgeReplay({ packet })).toThrow(/complete retained Evidence Packet/);
  });
});
