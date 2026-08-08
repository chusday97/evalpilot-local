import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import type { AiStructuredRequest, EvalCase } from '../types.js';
import { MockAiProvider } from '../src/ai/mock-provider.js';
import { runAiTestAgent } from '../src/test-agent/agent-runner.js';

const now = '2026-08-09T01:00:00.000Z';

function evalCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    caseId: 'case-semantic-browser', projectId: 'project-semantic-browser', setType: 'baseline', status: 'stable', origin: { type: 'human', note: 'Phase 5 fixture' }, capabilityId: 'cap-semantic', taskId: null,
    title: '完成页面任务', hypothesis: '用户能看到明确结果', persona: { personaId: 'persona-guided', name: '普通用户', knowledgeLevel: 'medium', patienceTurns: 3, retryTolerance: 1, privacySensitivity: 'medium', behaviorPolicy: ['只使用可见安全入口'], exitConditions: ['连续失败后退出'] },
    goal: '完成页面任务', knownInformation: { project_name: 'Semantic demo' }, preconditions: [], oracle: { expectedOutcome: ['显示 Completed'], mustObserve: ['Completed'], mustNotObserve: ['Error'], businessRules: [], semanticRubric: ['任务结果清晰可见'], deterministicAssertions: [], inconclusiveWhen: ['证据不足'] }, coverageDimensions: [{ dimension: 'capability', value: 'cap-semantic' }], riskLevel: 'P1', generationReason: 'Phase 5 browser fixture', version: 1,
    stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 1, lastExecutedAt: null }, regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: now, updatedAt: now,
    ...overrides,
  };
}

function semanticResponse(request: AiStructuredRequest) {
  const input = JSON.parse(request.userPrompt) as { expectation: string; action: { action: string }; after: { summary: string; evidenceRefs: string[] } };
  const summary = input.after.summary;
  const confirmed = input.action.action === 'fill' || ['Created', 'Ready', 'Completed', 'Recovered home'].some((value) => summary.includes(value));
  return {
    status: confirmed ? 'confirmed' : 'not_confirmed',
    observed: confirmed ? '预期结果已在动作后页面中出现。' : '动作后页面没有出现预期结果。',
    confirmedFacts: confirmed ? ['动作后页面出现预期结果'] : [],
    unknowns: confirmed ? [] : ['当前操作是否触发隐藏状态未知'],
    evidenceRefs: input.after.evidenceRefs,
    confidence: 0.95,
  };
}

async function runOnPage(page: Page, provider: MockAiProvider, testCase: EvalCase, options: { useSemanticReflector?: boolean; maxSteps?: number } = {}) {
  return runAiTestAgent(page, testCase, provider, {
    outputDir: await mkdtemp(join(tmpdir(), 'evalpilot-semantic-verifier-')),
    startingUrl: page.url(),
    maxSteps: options.maxSteps ?? 6,
    waitTimeoutMs: 1_200,
    useSemanticReflector: options.useSemanticReflector,
    now: () => new Date(now),
  });
}

describe.skipIf(process.env.EVALPILOT_BROWSER_TEST !== '1')('Semantic Verifier browser acceptance', () => {
  it('completes an ordinary form with deterministic and semantic agreement', async () => {
    const browser = await chromium.launch({ headless: true }); const page = await browser.newPage();
    await page.setContent('<main><h1>Create</h1><label>Project name <input name="project_name"></label><button onclick="document.querySelector(\'main\').innerHTML=\'<h1>Created</h1><p>Completed</p>\'">Create</button></main>');
    const provider = new MockAiProvider((request) => {
      if (request.task === 'semantic_verifier') return semanticResponse(request);
      const input = JSON.parse(request.userPrompt) as { observation: { visibleStateSummary: string; formFields: Array<{ elementId: string; currentValuePresent: boolean }>; interactableElements: Array<{ elementId: string; label: string }> } };
      if (input.observation.visibleStateSummary.includes('Completed')) return { intentSummary: '任务完成', action: 'finish', targetElementId: null, value: null, expectedResult: 'Completed', confidence: 1 };
      const field = input.observation.formFields[0]; if (field && !field.currentValuePresent) return { intentSummary: '填写名称', action: 'fill', targetElementId: field.elementId, value: null, expectedResult: '项目名称已填写', confidence: 1 };
      const button = input.observation.interactableElements.find((item) => item.label === 'Create'); return { intentSummary: '提交', action: 'click', targetElementId: button?.elementId ?? null, value: null, expectedResult: 'Completed', confidence: 1 };
    });
    const result = await runOnPage(page, provider, evalCase());
    expect(result).toMatchObject({ status: 'completed', failureSource: null });
    expect(result.decisions.map((item) => item.action)).toEqual(['fill', 'click', 'finish']);
    expect(provider.requests.filter((item) => item.task === 'semantic_verifier')).toHaveLength(3);
    await browser.close();
  });

  it('waits for delayed loading to finish before verifying', async () => {
    const browser = await chromium.launch({ headless: true }); const page = await browser.newPage();
    await page.setContent('<main><h1>Generator</h1><button onclick="this.remove();document.querySelector(\'main\').insertAdjacentHTML(\'beforeend\',\'<p role=progressbar>Loading</p>\');setTimeout(()=>document.querySelector(\'main\').innerHTML=\'<h1>Ready</h1><p>Completed</p>\',350)">Generate</button></main>');
    const provider = new MockAiProvider((request) => {
      if (request.task === 'semantic_verifier') return semanticResponse(request);
      const input = JSON.parse(request.userPrompt) as { observation: { visibleStateSummary: string } };
      return input.observation.visibleStateSummary.includes('Completed')
        ? { intentSummary: '结果完成', action: 'finish', targetElementId: null, value: null, expectedResult: 'Completed', confidence: 1 }
        : { intentSummary: '开始生成', action: 'click', targetElementId: 'E001', value: null, expectedResult: 'Ready Completed', confidence: 1 };
    });
    const result = await runOnPage(page, provider, evalCase({ caseId: 'case-delayed' }));
    expect(result.status).toBe('completed');
    expect(result.actionResults[0]?.summary).toContain('预期文字');
    await browser.close();
  });

  it('waits for the terminal text of a streaming result', async () => {
    const browser = await chromium.launch({ headless: true }); const page = await browser.newPage();
    await page.setContent('<main><h1>Stream</h1><button onclick="this.remove();const p=document.createElement(\'p\');p.id=\'out\';p.textContent=\'Working\';document.querySelector(\'main\').append(p);let n=0;const id=setInterval(()=>{n++;p.textContent+=\' .\';if(n===4){clearInterval(id);p.textContent+=\' Completed\'}},100)">Start</button></main>');
    const provider = new MockAiProvider((request) => {
      if (request.task === 'semantic_verifier') return semanticResponse(request);
      const input = JSON.parse(request.userPrompt) as { observation: { visibleStateSummary: string } };
      return input.observation.visibleStateSummary.includes('Completed')
        ? { intentSummary: '流式结果完成', action: 'finish', targetElementId: null, value: null, expectedResult: 'Completed', confidence: 1 }
        : { intentSummary: '启动流式任务', action: 'click', targetElementId: 'E001', value: null, expectedResult: 'Completed', confidence: 1 };
    });
    const result = await runOnPage(page, provider, evalCase({ caseId: 'case-streaming' }));
    expect(result.status).toBe('completed');
    expect(result.actionResults[0]?.summary).toContain('预期文字');
    await browser.close();
  });

  it('abandons a no-feedback action at the explicit persona patience bound', async () => {
    const browser = await chromium.launch({ headless: true }); const page = await browser.newPage();
    await page.setContent('<main><h1>Draft</h1><button>Save</button></main>');
    const provider = new MockAiProvider((request) => request.task === 'semantic_verifier'
      ? semanticResponse(request)
      : { intentSummary: '尝试保存', action: 'click', targetElementId: 'E001', value: null, expectedResult: 'Completed', confidence: 1 });
    const testCase = evalCase({ caseId: 'case-no-feedback', persona: { ...evalCase().persona, patienceTurns: 2, retryTolerance: 1 } });
    const result = await runOnPage(page, provider, testCase);
    expect(result.status).toBe('abandoned');
    expect(result.decisions).toHaveLength(2);
    expect(result.reflections.at(-1)).toMatchObject({ nextStep: 'abandon', summary: expect.stringContaining('2 步耐心边界') });
    await browser.close();
  });

  it('uses semantic reflection while recovering from a wrong path', async () => {
    const browser = await chromium.launch({ headless: true }); const page = await browser.newPage();
    await page.setContent(`<main></main><script>
      const render=()=>document.querySelector('main').innerHTML=location.hash==='#error'?'<h1>Error path</h1><p>Wrong destination</p>':'<h1>Recovered home</h1><a href="#error">Open wrong path</a>';
      addEventListener('hashchange',render);render();
    </script>`);
    const provider = new MockAiProvider((request) => {
      if (request.task === 'semantic_verifier') return semanticResponse(request);
      if (request.task === 'semantic_reflector') {
        const input = JSON.parse(request.userPrompt) as { verification: { status: string } };
        return input.verification.status === 'confirmed'
          ? { nextStep: 'continue', summary: '当前路径已经恢复。', confidence: 0.95 }
          : { nextStep: 'backtrack', summary: '当前路径错误，返回上一状态。', confidence: 0.95 };
      }
      const input = JSON.parse(request.userPrompt) as { observation: { visibleStateSummary: string } };
      if (input.observation.visibleStateSummary.includes('Error path')) return { intentSummary: '返回安全路径', action: 'back', targetElementId: null, value: null, expectedResult: 'Recovered home', confidence: 1 };
      if (input.observation.visibleStateSummary.includes('Wrong destination')) return { intentSummary: '返回', action: 'back', targetElementId: null, value: null, expectedResult: 'Recovered home', confidence: 1 };
      if (input.observation.visibleStateSummary.includes('Recovered home') && request.requestId !== 'actor-1') return { intentSummary: '恢复完成', action: 'finish', targetElementId: null, value: null, expectedResult: 'Recovered home', confidence: 1 };
      return { intentSummary: '尝试入口', action: 'click', targetElementId: 'E001', value: null, expectedResult: 'Task complete', confidence: 1 };
    });
    const result = await runOnPage(page, provider, evalCase({ caseId: 'case-recovery', persona: { ...evalCase().persona, patienceTurns: 4 } }), { useSemanticReflector: true });
    expect(result.status).toBe('completed');
    expect(result.decisions.map((item) => item.action)).toEqual(['click', 'back', 'finish']);
    expect(result.reflections[0]).toMatchObject({ nextStep: 'backtrack' });
    await browser.close();
  });
});
