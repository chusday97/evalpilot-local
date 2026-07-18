import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CoverageReport, EvalPilotConfig, RunResult, Scenario } from '../types.js';
import { buildReport } from '../src/report/report-builder.js';

function scenario(caseId: string, severityIfFailed: Scenario['severityIfFailed']): Scenario {
  return {
    caseId,
    title: `scenario ${caseId}`,
    capability: 'cap-core',
    persona: 'persona-new-user',
    intentType: '核心功能',
    inputQuality: '完整',
    systemState: '正常',
    journeyStage: '核心任务',
    goal: 'complete core task',
    preconditions: [],
    input: {},
    steps: [{ action: 'goto', target: '/' }],
    expectedBehavior: ['complete'],
    forbiddenBehavior: ['crash'],
    hardAssertions: ['page visible'],
    rubric: ['quality'],
    severityIfFailed,
    source: 'fixture',
    approvalStatus: 'draft',
    automationStatus: 'automated',
  };
}

function result(caseId: string, status: RunResult['status']): RunResult {
  return {
    runId: `run-${caseId}`,
    caseId,
    steps: [],
    finalUrl: 'http://localhost:3000',
    screenshots: [`${caseId}.png`],
    trace: `${caseId}.zip`,
    consoleErrors: [],
    networkErrors: [],
    durationMs: 10,
    actualResult: status === 'blocked' ? 'fault did not match' : 'button missing',
    expectedResult: ['complete'],
    status,
    executedAt: new Date().toISOString(),
  };
}

async function fixture(): Promise<{ config: EvalPilotConfig; failed: Scenario }> {
  const root = await mkdtemp(join(tmpdir(), 'evalpilot-report-'));
  const outputDir = resolve(root, '.evalpilot');
  await mkdir(resolve(outputDir, 'runs', '2026-01-01'), { recursive: true });
  await mkdir(resolve(outputDir, 'reports'), { recursive: true });
  await mkdir(resolve(outputDir, 'regression'), { recursive: true });
  const failed = scenario('case-failed', 'P1');
  const blocked = scenario('case-blocked', 'P1');
  await writeFile(resolve(outputDir, 'scenarios.jsonl'), `${JSON.stringify(failed)}\n${JSON.stringify(blocked)}\n`);
  const results = [result('case-failed', 'failed'), result('case-blocked', 'blocked')];
  await writeFile(
    resolve(outputDir, 'runs', '2026-01-01', 'summary.json'),
    JSON.stringify({ targetUrl: 'http://localhost:3000', total: 2, passed: 0, failed: 1, blocked: 1, results, completedAt: new Date().toISOString() }),
  );
  const coverage: CoverageReport = { totalCases: 2, automatedCases: 2, dimensions: { capabilities: { covered: ['cap-core'], missing: [], ratio: 1 } } };
  await writeFile(resolve(outputDir, 'reports', 'coverage.json'), JSON.stringify(coverage));
  await writeFile(resolve(outputDir, 'regression', 'regression-cases.jsonl'), '');
  return {
    config: { version: 1, projectRoot: root, targetUrl: 'http://localhost:3000', outputDir, browser: 'chromium', createdAt: new Date().toISOString() },
    failed,
  };
}

describe('report and regression preparation', () => {
  it('separates failed and blocked results and does not auto-add regression', async () => {
    const { config } = await fixture();
    const report = await buildReport(config, false);
    expect(report.recommendation).toBe('不建议上线');
    expect(report.issues).toHaveLength(2);
    expect(report.issues.find((issue) => issue.caseId === 'case-failed')?.severity).toBe('P1');
    expect(report.issues.find((issue) => issue.caseId === 'case-blocked')?.severity).toBe('P2');
    expect(report.confirmedFailuresAdded).toBe(0);
    expect(await readFile(resolve(config.outputDir, 'regression', 'regression-cases.jsonl'), 'utf8')).toBe('');
  });

  it('adds only explicitly confirmed failed cases and de-duplicates them', async () => {
    const { config } = await fixture();
    expect((await buildReport(config, true)).confirmedFailuresAdded).toBe(1);
    expect((await buildReport(config, true)).confirmedFailuresAdded).toBe(0);
    const rows = (await readFile(resolve(config.outputDir, 'regression', 'regression-cases.jsonl'), 'utf8')).trim().split('\n');
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0] as string)).toMatchObject({ originalIssueId: 'issue-case-failed', lastRunResult: 'failed' });
  });
});
