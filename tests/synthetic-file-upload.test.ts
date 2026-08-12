import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import type { EvalCase } from '../types.js';
import { MockAiProvider } from '../src/ai/mock-provider.js';
import { materializeSyntheticFileFixtures, resolveSyntheticFileFixtures } from '../src/scenario/file-fixture-resolver.js';
import type { ExecutableScenario } from '../src/scenario/scenario-compiler.js';
import { runAiTestAgent } from '../src/test-agent/agent-runner.js';
import { evidencePacketSchema } from '../src/test-agent/schemas.js';

const browserIt = process.env.EVALPILOT_BROWSER_TEST === '1' ? it : it.skip;
const now = '2026-08-12T08:30:00.000Z';
let browser: Browser | null = null;

afterEach(async () => { await browser?.close(); browser = null; });

function evalCase(): EvalCase {
  return {
    caseId: 'case-csv-upload', projectId: 'project-upload', setType: 'baseline', status: 'stable', origin: { type: 'human', note: 'synthetic file upload fixture' }, capabilityId: 'cap-upload', taskId: 'task-upload', title: '上传 CSV', hypothesis: '合成 CSV 可以被页面处理', persona: { personaId: 'persona', name: '测试用户', behaviorPolicy: ['只执行安全操作'] }, goal: '上传测试 CSV 并看到处理完成', knownInformation: {}, preconditions: ['测试 CSV 文件已准备'],
    oracle: { expectedOutcome: ['Processed fixture'], mustObserve: ['Processed fixture'], mustNotObserve: [], businessRules: [], semanticRubric: [], deterministicAssertions: [{ assertionId: 'assert-processed', type: 'text_visible', target: 'Processed fixture', expected: true, negated: false }], inconclusiveWhen: [] }, coverageDimensions: [], riskLevel: 'P1', generationReason: 'fixture', version: 1, stats: { passCount: 0, failCount: 0, inconclusiveCount: 0, latestResult: null, latestRunId: null, uniqueCoverageContribution: 0, lastExecutedAt: null }, regressionMetadata: null, retirementReason: null, needsHumanReview: false, createdAt: now, updatedAt: now,
  };
}

function scenario(url: string): ExecutableScenario {
  return {
    scenarioId: 'scenario-csv-upload', projectId: 'project-upload', caseId: 'case-csv-upload', capabilityId: 'cap-upload', taskId: 'task-upload', goal: '上传测试 CSV 并看到处理完成', startingUrl: url, readiness: 'needs_test_data',
    blockers: [{ blockerId: 'file', type: 'needs_test_data', summary: '需要测试 CSV 文件。', source: 'precondition', sourceValue: '测试 CSV 文件已准备' }],
    preconditions: [{ text: '测试 CSV 文件已准备', status: 'unresolved', reason: '需要测试文件。' }], knownInformationKeys: [], generatedAt: now,
  };
}

async function fixtureServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><body><main><h1>CSV Import</h1><input id="file" type="file" accept=".csv"><p id="status">Waiting</p><p id="name"></p></main><script>const input=document.querySelector('#file');input.addEventListener('change',()=>{document.querySelector('#name').textContent=input.files[0]?.name||'';document.querySelector('#status').textContent='Processing fixture';setTimeout(()=>{document.querySelector('#status').textContent='Processed fixture'},180);});</script></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture server did not expose a port');
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

describe('Synthetic file upload', () => {
  browserIt('overrides an arbitrary model path with the approved fixture and waits for file processing', async () => {
    const fixture = await fixtureServer();
    try {
      const resolution = resolveSyntheticFileFixtures({ scenario: scenario(fixture.url), targetUrl: fixture.url });
      expect(resolution.status).toBe('ready');
      const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-upload-'));
      const files = await materializeSyntheticFileFixtures(resolution.plan!, join(outputDir, 'fixtures'));
      const csv = files[0]!;
      const provider = new MockAiProvider((request) => {
        if (request.task === 'semantic_verifier') return { status: 'confirmed', observed: '可见状态符合预期。', confirmedFacts: ['文件处理状态发生变化'], unknowns: [], evidenceRefs: [], confidence: 0.95 };
        const prompt = JSON.parse(request.userPrompt) as { observation: { visibleStateSummary: string; formFields: Array<{ elementId: string; inputType: string; currentValuePresent: boolean }> } };
        if (prompt.observation.visibleStateSummary.includes('Processed fixture')) return { intentSummary: '文件已处理完成', action: 'finish', targetElementId: null, value: null, expectedResult: 'Processed fixture', confidence: 1 };
        const field = prompt.observation.formFields.find((item) => item.inputType === 'file');
        return { intentSummary: '上传 CSV', action: 'fill', targetElementId: field?.elementId ?? null, value: '/etc/passwd', expectedResult: 'Processed fixture', confidence: 1 };
      });

      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      const run = await runAiTestAgent(page, evalCase(), provider, { outputDir, startingUrl: fixture.url, fileFixtures: files, allowRemoteModel: true, allowScreenshotToProvider: false, productModelVersion: 1, evalSetVersion: 1, judgeModel: provider.info.model, now: () => new Date(now) });
      const packet = evidencePacketSchema.parse(JSON.parse(await readFile(run.evidencePacketPath, 'utf8')));

      expect(run.status).toBe('completed');
      expect(run.decisions[0]?.action).toBe('fill');
      expect(run.decisions[0]?.value).toBe(csv.fixtureId);
      expect(run.decisions[0]?.value).not.toBe('/etc/passwd');
      expect(packet.finalState.visibleTextSummary).toContain('Processed fixture');
      expect(packet.finalState.visibleTextSummary).toContain('evalpilot-fixture.csv');
      expect(packet.stepEvidence[0]?.taskWait?.operationType).toBe('file_processing');
      expect(provider.requests.every((request) => !request.userPrompt.includes(csv.path))).toBe(true);
      expect(provider.requests.every((request) => !request.userPrompt.includes('/etc/passwd'))).toBe(true);
    } finally {
      await fixture.close();
    }
  });
});
