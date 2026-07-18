import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stringify } from 'yaml';
import type { EvalPilotConfig, JourneyComparison, UxIssue } from '../types.js';
import { buildBeforeAfterComparison } from '../src/ux-evaluation/before-after-comparison.js';
import { buildConfirmedComparisons } from '../src/ux-evaluation/comparison-service.js';
import type { ExploratoryRunSummary } from '../src/ux-evaluation/exploratory-runner.js';

function journey(runId: string, extraActionCount: number, fullLoopCompleted = true): JourneyComparison {
  return { featureId: 'cap-1', runId, idealActionCount: 5, actualActionCount: 5 + extraActionCount, shortestReasonableActionCount: 5, extraActionCount, pageTransitions: 1, backtrackCount: 0, repeatedInputCount: 0, deadEndCount: 0, taskCompleted: true, fullLoopCompleted, evidence: [`${runId}/trace.zip`] };
}

const issue = {
  issueId: 'ux-1', protectedSafetySteps: ['确认公开范围'], evidence: ['before/trace.zip'],
} as UxIssue;

describe('before/after UX comparison', () => {
  it('marks fewer actions with preserved closure and safety as improved', () => {
    const comparison = buildBeforeAfterComparison({ issue, before: journey('before', 3), after: journey('after', 0), safetyConstraintsPreserved: true, newIssueIds: [] });
    expect(comparison.verdict).toBe('improved');
    expect(comparison.safetyConstraintsPreserved).toBe(true);
  });

  it('marks lost safety or a new issue as regressed even when actions decrease', () => {
    const unsafe = buildBeforeAfterComparison({ issue, before: journey('before', 3), after: journey('after', 0), safetyConstraintsPreserved: false, newIssueIds: [] });
    const newIssue = buildBeforeAfterComparison({ issue, before: journey('before', 3), after: journey('after', 0), safetyConstraintsPreserved: true, newIssueIds: ['ux-new'] });
    expect(unsafe.verdict).toBe('regressed');
    expect(newIssue.verdict).toBe('regressed');
  });

  it('does not call fewer clicks an improvement when the full loop is lost', () => {
    const comparison = buildBeforeAfterComparison({ issue, before: journey('before', 2, true), after: journey('after', 0, false), safetyConstraintsPreserved: true, newIssueIds: [] });
    expect(comparison.verdict).toBe('regressed');
  });

  it('persists a comparison after a confirmed issue is rerun', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-comparison-'));
    await mkdir(resolve(outputDir, 'runs', 'before'), { recursive: true });
    await mkdir(resolve(outputDir, 'journeys'), { recursive: true });
    await mkdir(resolve(outputDir, 'comparisons'), { recursive: true });
    await writeFile(resolve(outputDir, 'runs', 'before', 'journey-comparison.json'), JSON.stringify(journey('before', 3)));
    await writeFile(resolve(outputDir, 'journeys', 'cap-1.yaml'), stringify({ steps: [{ label: '确认公开范围', type: 'safety' }] }));
    const config = { outputDir } as EvalPilotConfig;
    const confirmed = { ...issue, featureId: 'cap-1', addedToRegression: true, evidence: [resolve(outputDir, 'runs', 'before', 'screenshots', 'action.png')] } as UxIssue;
    const afterRun = { runId: 'after', comparison: journey('after', 0), issues: [] } as unknown as ExploratoryRunSummary;

    const comparisons = await buildConfirmedComparisons(config, [confirmed], afterRun);

    expect(comparisons).toHaveLength(1);
    expect(comparisons[0]?.verdict).toBe('improved');
    await expect(readFile(resolve(outputDir, 'comparisons', `${comparisons[0]?.comparisonId}.json`), 'utf8')).resolves.toContain('"improved"');
  });
});
