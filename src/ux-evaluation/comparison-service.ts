import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BeforeAfterComparison, EvalPilotConfig, JourneyComparison, UxIssue } from '../../types.js';
import { pathExists, readYamlFile, writeJsonAtomic } from '../utils/file-system.js';
import type { ExploratoryRunSummary } from './exploratory-runner.js';
import { buildBeforeAfterComparison } from './before-after-comparison.js';

function runIdFromEvidence(issue: UxIssue): string | null {
  for (const evidence of issue.evidence) {
    const match = evidence.match(/[/\\]runs[/\\]([^/\\]+)[/\\]/);
    if (match?.[1]) return match[1];
  }
  return null;
}

export async function buildConfirmedComparisons(
  config: EvalPilotConfig,
  confirmedIssues: UxIssue[],
  afterRun: ExploratoryRunSummary,
): Promise<BeforeAfterComparison[]> {
  const comparisons: BeforeAfterComparison[] = [];
  for (const issue of confirmedIssues.filter((item) => item.addedToRegression && item.featureId === afterRun.comparison.featureId)) {
    const beforeRunId = runIdFromEvidence(issue);
    if (!beforeRunId || !/^[a-zA-Z0-9._-]+$/.test(beforeRunId) || beforeRunId === afterRun.runId) continue;
    const beforePath = resolve(config.outputDir, 'runs', beforeRunId, 'journey-comparison.json');
    const journeyPath = resolve(config.outputDir, 'journeys', `${issue.featureId}.yaml`);
    if (!(await pathExists(beforePath)) || !(await pathExists(journeyPath))) continue;
    const before = JSON.parse(await readFile(beforePath, 'utf8')) as JourneyComparison;
    const journey = await readYamlFile<{ steps?: Array<{ label: string; type: string }> }>(journeyPath);
    const currentSafetySteps = new Set((journey.steps ?? []).filter((step) => step.type === 'safety').map((step) => step.label));
    const safetyConstraintsPreserved = issue.protectedSafetySteps.every((step) => currentSafetySteps.has(step));
    const newIssueIds = afterRun.issues.filter((item) => item.featureId === issue.featureId && item.issueId !== issue.issueId).map((item) => item.issueId);
    const comparison = buildBeforeAfterComparison({ issue, before, after: afterRun.comparison, safetyConstraintsPreserved, newIssueIds });
    await writeJsonAtomic(resolve(config.outputDir, 'comparisons', `${comparison.comparisonId}.json`), comparison);
    comparisons.push(comparison);
  }
  return comparisons;
}
