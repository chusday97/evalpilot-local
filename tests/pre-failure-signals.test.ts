import { describe, expect, it } from 'vitest';
import { collectObservedPreFailureSignals, type PreFailureSignalSource } from '../src/ux-evaluation/pre-failure-signals.js';

function sourceWithFailure(summary: string): PreFailureSignalSource {
  return {
    agentRun: {
      decisions: [
        { decisionId: 'decision-001', action: 'click', targetElementId: 'E003' },
        { decisionId: 'decision-002', action: 'click', targetElementId: 'E007' },
      ],
      actionResults: [
        {
          summary,
          evidenceRefs: ['screenshots/step-001-before.png', 'screenshots/step-001-after.png'],
        },
        {
          summary: 'click executed and the journey continued.',
          evidenceRefs: ['screenshots/step-002-before.png', 'screenshots/step-002-after.png'],
        },
      ],
    },
    evidencePacket: {
      observations: [
        {
          observationId: 'observation-001-before',
          interactableElements: [
            { elementId: 'E003', label: '标准款', text: '标准款' },
          ],
          formFields: [],
        },
      ],
      stepVerifications: [
        {
          verificationId: 'verification-001',
          observed: summary,
          evidenceRefs: ['verifications.jsonl#verification-001'],
        },
      ],
      stepEvidence: [
        {
          stepIndex: 1,
          beforeObservationId: 'observation-001-before',
          beforeScreenshotPath: 'screenshots/step-001-before.png',
          afterScreenshotPath: 'screenshots/step-001-after.png',
          decisionId: 'decision-001',
          verificationId: 'verification-001',
          actionStatus: 'failed',
          taskState: {
            failureSignals: [summary],
            evidenceRefs: ['task-state-observations.jsonl#step-001-poll-001'],
          },
        },
        {
          stepIndex: 2,
          beforeObservationId: 'observation-002-before',
          beforeScreenshotPath: 'screenshots/step-002-before.png',
          afterScreenshotPath: 'screenshots/step-002-after.png',
          decisionId: 'decision-002',
          verificationId: 'verification-002',
          actionStatus: 'executed',
          taskState: null,
        },
      ],
    },
  };
}

describe('connected-smoke pre-failure signal extraction', () => {
  it('preserves a pointer interception that happened before a later terminal runtime failure', () => {
    const summary = `locator.click: Timeout 30000ms exceeded.\n` +
      `- <button id="group-variant-wishlist-item-001" aria-label="Added to wishlist: target species">…</button> intercepts pointer events`;

    const signals = collectObservedPreFailureSignals(sourceWithFailure(summary));

    expect(signals).toEqual([
      expect.objectContaining({
        type: 'action_execution_failure',
        stepIndex: 1,
        action: 'click',
        targetElementId: 'E003',
        targetLabel: '标准款',
        cause: 'pointer_interception',
        interceptedBy: 'group-variant-wishlist-item-001',
        interceptedByLabel: 'Added to wishlist: target species',
      }),
    ]);
    expect(signals[0]?.evidenceRefs).toEqual(expect.arrayContaining([
      'screenshots/step-001-before.png',
      'screenshots/step-001-after.png',
      'task-state-observations.jsonl#step-001-poll-001',
    ]));
  });

  it('keeps generic action failures without inventing a product cause', () => {
    const signals = collectObservedPreFailureSignals(sourceWithFailure('locator.click failed for an unknown reason.'));

    expect(signals[0]).toEqual(expect.objectContaining({
      cause: 'action_execution_failure',
      interceptedBy: null,
      interceptedByLabel: null,
    }));
  });

  it('returns no sidecar signal when every action executed', () => {
    const source = sourceWithFailure('unused');
    source.evidencePacket.stepEvidence[0]!.actionStatus = 'executed';

    expect(collectObservedPreFailureSignals(source)).toEqual([]);
  });
});
