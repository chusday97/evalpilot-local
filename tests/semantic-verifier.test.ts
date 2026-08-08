import { describe, expect, it } from 'vitest';
import { evalPersonaRefSchema } from '../src/eval-set/schemas.js';
import { reflectOnStep } from '../src/test-agent/reflector.js';
import { mergeStepVerifications } from '../src/test-agent/verification-merger.js';
import { runSemanticStepVerifier } from '../src/test-agent/semantic-verifier.js';
import type { AiProvider } from '../src/ai/provider.js';
import type { AiStructuredRequest, EvalCase, PageObservation, SemanticStepVerification, StepVerification } from '../types.js';

const deterministic: StepVerification = { verificationId: 'verification-1', expectation: '显示完成结果', observed: '页面状态发生变化。', status: 'confirmed', evidenceRefs: ['after.png'], confidence: 0.9 };
const semantic: SemanticStepVerification = { status: 'confirmed', observed: '完成结果可见。', confirmedFacts: ['完成结果可见'], unknowns: [], evidenceRefs: ['after.png'], confidence: 0.95 };
const observation: PageObservation = { observationId: 'observation-1', pageUrl: 'https://example.test/', pagePurpose: 'Test', visibleStateSummary: 'Test page', primaryAreas: ['Test'], visibleProblems: [], interactableElements: [], formFields: [], evidenceRefs: ['shot.png'], confidence: 1 };

function evalCase(): EvalCase {
  const now = '2026-08-09T00:00:00.000Z';
  return {
    caseId: 'case-policy', projectId: 'project-policy', setType: 'baseline', status: 'stable', origin: { type: 'human', note: 'fixture' }, capabilityId: 'cap-policy', taskId: null,
    title: '完成任务', hypothesis: '用户可以完成任务', persona: { personaId: 'persona-low', name: '低耐心用户', knowledgeLevel: 'low', patienceTurns: 1, retryTolerance: 0, privacySensitivity: 'high', behaviorPolicy: ['这段文案有很多条', '不能作为耐心计数'], exitConditions: ['一次失败后退出'] },
    goal: '完成任务', knownInformation: {}, preconditions: [], oracle: { expectedOutcome: ['完成'], mustObserve: [], mustNotObserve: [], businessRules: [], semanticRubric: ['完成'], deterministicAssertions: [], inconclusiveWhen: ['证据不足'] }, coverageDimensions: [], riskLevel: 'P2', generationReason: 'fixture', version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 0, lastExecutedAt: null }, regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: now, updatedAt: now,
  };
}

describe('semantic step verification merger', () => {
  it('lets deterministic hard failure win', () => {
    expect(mergeStepVerifications({ deterministic: { ...deterministic, status: 'not_confirmed', observed: '动作执行失败。', confidence: 1 }, semantic, hardFailure: true, expectation: deterministic.expectation, visualEvidenceIncluded: true })).toMatchObject({ status: 'not_confirmed', deterministicStatus: 'not_confirmed' });
  });

  it('does not let low-confidence semantics independently confirm an inconclusive signal', () => {
    expect(mergeStepVerifications({ deterministic: { ...deterministic, status: 'inconclusive' }, semantic: { ...semantic, confidence: 0.6 }, hardFailure: false, expectation: deterministic.expectation, visualEvidenceIncluded: true }).status).toBe('inconclusive');
  });

  it('returns inconclusive when deterministic and semantic signals disagree', () => {
    expect(mergeStepVerifications({ deterministic, semantic: { ...semantic, status: 'not_confirmed' }, hardFailure: false, expectation: deterministic.expectation, visualEvidenceIncluded: true }).status).toBe('inconclusive');
  });

  it('refuses visual confirmation without authorized screenshot evidence', () => {
    const result = mergeStepVerifications({ deterministic, semantic, hardFailure: false, expectation: '确认按钮颜色和布局正确', visualEvidenceIncluded: false });
    expect(result).toMatchObject({ status: 'inconclusive', observed: expect.stringContaining('未授权截图') });
  });

  it('does not send screenshots to a remote verifier without explicit authorization', async () => {
    let captured: AiStructuredRequest | null = null;
    const provider: AiProvider = {
      info: { providerId: 'remote-fixture', model: 'fixture', remote: true, structuredOutput: true, screenshotInput: true },
      async generateStructured(request, schema) { captured = request; return schema.parse({ ...semantic, evidenceRefs: ['after.png', 'invented.png'] }); },
    };
    const result = await runSemanticStepVerifier({ provider, decision: { intentSummary: '检查视觉', action: 'finish', targetElementId: null, value: null, expectedResult: '布局正确', confidence: 1 }, before: observation, after: { ...observation, observationId: 'observation-2' }, actionResult: { status: 'executed', action: 'finish', targetElementId: null, summary: 'finish 已执行', evidenceRefs: [] }, networkDelta: ['200 /result'], consoleDelta: [], beforeScreenshotDataUrl: 'data:image/png;base64,AAAA', afterScreenshotDataUrl: 'data:image/png;base64,BBBB', allowRemoteModel: true, allowScreenshot: false });
    expect(captured).toMatchObject({ task: 'semantic_verifier', imageDataUrls: [], privacy: { allowRemoteModel: true, allowScreenshot: false, visibleTextOnly: true } });
    expect(result.evidenceRefs).toEqual([]);
  });
});

describe('persona agent policy', () => {
  it('uses explicit patience rather than behaviorPolicy length', () => {
    const reflection = reflectOnStep({ evalCase: evalCase(), decision: { intentSummary: '点击', action: 'click', targetElementId: 'E001', value: null, expectedResult: '完成', confidence: 1 }, result: { status: 'executed', action: 'click', targetElementId: 'E001', summary: '已点击', evidenceRefs: [] }, verification: { ...deterministic, status: 'not_confirmed' }, failedAttempts: 1, retryAttempts: 1 });
    expect(reflection).toMatchObject({ nextStep: 'abandon', summary: expect.stringContaining('1 步耐心边界') });
  });

  it('adds compatibility defaults in memory for a legacy persona', () => {
    expect(evalPersonaRefSchema.parse({ personaId: 'legacy-user', name: '旧用户', behaviorPolicy: ['只看可见内容'] })).toEqual({ personaId: 'legacy-user', name: '旧用户', knowledgeLevel: 'medium', patienceTurns: 3, retryTolerance: 1, privacySensitivity: 'medium', behaviorPolicy: ['只看可见内容'], exitConditions: ['证据不足时退出'] });
  });
});
