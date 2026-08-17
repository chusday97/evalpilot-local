import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBadcase } from '../src/badcase/badcase-store.js';
import { loadEvalCase } from '../src/eval-set/eval-set-store.js';
import {
  AQUAGUIDE_PUI_BC_023_CONNECTED_RUN_ID,
  AQUAGUIDE_PUI_BC_023_PASSING_RUN_ID,
  AQUAGUIDE_PUI_BC_023_REGRESSION_CASE_ID,
  AQUAGUIDE_PUI_BC_023_TARGET_SHA,
  buildAquaGuidePuiBc023PassingRetest,
  promoteAquaGuidePuiBc023,
} from '../src/validation/aquaguide-pui-bc-023-lifecycle.js';

describe('AquaGuide PUI-BC-023 connected closure', () => {
  it('retains the exact connected PASS evidence used for lifecycle closure', async () => {
    const snapshot = JSON.parse(await readFile('acceptance/real-products/aquaguide-pui-bc-023-regression.json', 'utf8'));
    const passingRetest = buildAquaGuidePuiBc023PassingRetest();

    expect(snapshot.connectedRunId).toBe(AQUAGUIDE_PUI_BC_023_CONNECTED_RUN_ID);
    expect(snapshot.targetAppGitSha).toBe(AQUAGUIDE_PUI_BC_023_TARGET_SHA);
    expect(snapshot.sourceCaseId).toBe(passingRetest.caseId);
    expect(snapshot.passingRunId).toBe(AQUAGUIDE_PUI_BC_023_PASSING_RUN_ID);
    expect(snapshot.protocolHealthy).toBe(true);
    expect(snapshot.productJourneyPassed).toBe(true);
    expect(snapshot.failureCounts).toEqual({ provider: 0, evaluator: 0, unknown: 0 });
    expect(snapshot.semantic).toEqual({ verdict: 'pass', taskCompletion: 'complete', confidence: 0.95 });
    expect(snapshot.deterministicAssertionIds).toEqual(passingRetest.deterministic.checks.map((check) => check.assertionId));
    expect(passingRetest.verdict).toBe('pass');
    expect(passingRetest.failureSource).toBeNull();
  });

  it('promotes the fixed badcase through the real promoter into a stable Regression case', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'evalpilot-pui-bc-023-'));
    try {
      const promoted = await promoteAquaGuidePuiBc023(outputDir);

      expect(promoted.regressionCase.caseId).toBe(AQUAGUIDE_PUI_BC_023_REGRESSION_CASE_ID);
      expect(promoted.regressionCase.setType).toBe('regression');
      expect(promoted.regressionCase.status).toBe('stable');
      expect(promoted.regressionCase.origin).toMatchObject({ type: 'badcase', badcaseId: 'PUI-BC-023' });
      expect(promoted.regressionCase.stats).toMatchObject({ passCount: 1, failCount: 0, inconclusiveCount: 0, latestResult: 'pass', latestRunId: AQUAGUIDE_PUI_BC_023_PASSING_RUN_ID });
      expect(promoted.regressionCase.regressionMetadata).toMatchObject({ badcaseId: 'PUI-BC-023', sourceRunId: 'run-ai-2026-08-17T04-51-28-572Z' });
      expect(promoted.badcase.fixStatus).toBe('fixed');
      expect(promoted.badcase.regressionCaseId).toBe(AQUAGUIDE_PUI_BC_023_REGRESSION_CASE_ID);

      const savedCase = await loadEvalCase(outputDir, 'regression', AQUAGUIDE_PUI_BC_023_REGRESSION_CASE_ID);
      const savedBadcase = await loadBadcase(outputDir, 'PUI-BC-023');
      expect(savedCase.caseId).toBe(AQUAGUIDE_PUI_BC_023_REGRESSION_CASE_ID);
      expect(savedBadcase.regressionCaseId).toBe(AQUAGUIDE_PUI_BC_023_REGRESSION_CASE_ID);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('keeps the connected claim boundary narrow', async () => {
    const snapshot = JSON.parse(await readFile('acceptance/real-products/aquaguide-pui-bc-023-regression.json', 'utf8'));
    expect(snapshot.claimBoundary).toContain('AI-blind connected evidence; not a human-user failure-rate estimate.');
    expect(snapshot.claimBoundary).toContain('Regression promotion is based on the same EvalCase passing with failureSource=null.');
  });
});
