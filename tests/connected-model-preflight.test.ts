import { describe, expect, it } from 'vitest';
import { buildConnectedModelCalibrationPreflight } from '../src/ux-evaluation/connected-model-preflight.js';

const disconnected = {
  provider: null,
  displayName: null,
  configured: false,
  source: null,
  protocol: null,
  apiHost: null,
  model: null,
  connectedAt: null,
};

const connected = {
  provider: 'openai',
  displayName: 'OpenAI',
  configured: true,
  source: 'environment',
  protocol: 'openai_responses',
  apiHost: 'api.openai.com',
  model: 'fixture-model',
  connectedAt: null,
};

describe('connected-model calibration preflight', () => {
  it('blocks locally without a provider and makes no remote-call claim', () => {
    const result = buildConnectedModelCalibrationPreflight({
      connection: disconnected,
      outputRoot: '/tmp/calibration',
      runCount: 2,
      maxSteps: 6,
      allowScreenshotToProvider: false,
    });

    expect(result).toEqual(expect.objectContaining({
      status: 'blocked',
      canRun: false,
      remoteCallsMade: false,
      workload: expect.objectContaining({
        runs: 2,
        probesPerRun: 3,
        probeExecutions: 6,
        maxActorDecisionRequests: 36,
        additionalSemanticVerificationRequests: 'variable',
      }),
    }));
    expect(result.reasons.join(' ')).toContain('No configured remote provider');
  });

  it('reports only non-secret provider metadata and the exact suite/config that would run', () => {
    const result = buildConnectedModelCalibrationPreflight({
      connection: connected,
      outputRoot: '.evalpilot-calibration',
      runCount: 3,
      maxSteps: 8,
      allowScreenshotToProvider: true,
    });

    expect(result).toEqual(expect.objectContaining({
      status: 'ready',
      canRun: true,
      remoteCallsMade: false,
      provider: {
        configured: true,
        providerId: 'openai',
        displayName: 'OpenAI',
        model: 'fixture-model',
        protocol: 'openai_responses',
        apiHost: 'api.openai.com',
        source: 'environment',
      },
      executionConfig: { maxSteps: 8, allowScreenshotToProvider: true },
      workload: expect.objectContaining({
        runs: 3,
        probesPerRun: 3,
        probeExecutions: 9,
        maxActorDecisionRequests: 72,
      }),
    }));
    expect(result.probeSuite.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.probeSuite.probeIds).toEqual(['clean-one-click', 'no-feedback-retry', 'objective-dead-end']);
    expect(result.artifactPlan.rawRunArtifactPattern).toContain('connected-model-calibration.json');
    expect(JSON.stringify(result)).not.toContain('apiKey');
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});
