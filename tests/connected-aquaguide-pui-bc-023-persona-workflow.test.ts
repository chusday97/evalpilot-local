import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AQUAGUIDE_PUI_BC_023_PERSONA_CHALLENGE_ID,
  selectAquaGuidePuiBc023NextChallenge,
} from '../src/validation/aquaguide-pui-bc-023-challenges.js';

describe('connected AquaGuide Daily low-patience persona Challenge workflow', () => {
  it('uses the selected candidate without promoting it before execution', () => {
    const candidate = selectAquaGuidePuiBc023NextChallenge();
    expect(candidate.caseId).toBe(AQUAGUIDE_PUI_BC_023_PERSONA_CHALLENGE_ID);
    expect(candidate.setType).toBe('challenge');
    expect(candidate.status).toBe('candidate');
    expect(candidate.persona).toMatchObject({
      personaId: 'persona-low-patience',
      patienceTurns: 1,
      retryTolerance: 0,
    });
    expect(candidate.stats).toMatchObject({
      passCount: 0,
      failCount: 0,
      inconclusiveCount: 0,
      latestResult: null,
      latestRunId: null,
    });
  });

  it('keeps the runner backward compatible while exposing an explicit persona Challenge mode', async () => {
    const script = await readFile(resolve('scripts/run-connected-aquaguide-daily-retest.ts'), 'utf8');
    expect(script).toContain("const challengeMode = arg('--challenge', 'none');");
    expect(script).toContain("challengeMode === 'persona'");
    expect(script).toContain('selectAquaGuidePuiBc023NextChallenge()');
    expect(script).toContain('connected_aquaguide_daily_persona_challenge');
    expect(script).toContain("journeyMode: isPersonaChallenge ? 'daily_persona_challenge' : 'daily_only'");
    expect(script).toContain('allowScreenshotToProvider: false');
    expect(script).toContain('prerequisiteRemoteCalls: 0');
    expect(script).toContain('buildAquaGuideDailyRetestCase()');
  });

  it('requires manual paid authorization and treats trustworthy Product FAIL as an evaluation result, not evaluator failure', async () => {
    const workflow = await readFile(resolve('.github/workflows/connected-aquaguide-daily-persona-challenge.yml'), 'utf8');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^\s+push:/m);
    expect(workflow).not.toMatch(/^\s+pull_request:/m);
    expect(workflow).not.toMatch(/^\s+schedule:/m);
    expect(workflow).toContain('RUN_CONNECTED_AQUAGUIDE_DAILY_PERSONA_CHALLENGE');
    expect(workflow).toContain('MAX_STEPS:');
    expect(workflow).toContain("'12'");
    expect(workflow).toContain('--challenge persona');
    expect(workflow).toContain('connected_aquaguide_daily_persona_challenge_preflight');
    expect(workflow).toContain('case-challenge-blind-daily-check-risk-persona');
    expect(workflow).toContain("result.taskResult?.failureSource === 'product'");
    expect(workflow).toContain('trustworthyProductFail');
    expect(workflow).toContain('challengeCoverageVerified: trustworthyPass');
    expect(workflow).toContain('allowScreenshotToProvider');

    const productFailDeclaration = workflow.indexOf('const trustworthyProductFail');
    const trustworthyVerdictGate = workflow.indexOf('if (!trustworthyPass && !trustworthyProductFail)');
    const passOnlyBranch = workflow.indexOf('if (trustworthyPass) {');
    const passOnlyProductCheck = workflow.indexOf('result.productJourneyPassed !== true');
    expect(productFailDeclaration).toBeGreaterThan(-1);
    expect(trustworthyVerdictGate).toBeGreaterThan(productFailDeclaration);
    expect(passOnlyBranch).toBeGreaterThan(trustworthyVerdictGate);
    expect(passOnlyProductCheck).toBeGreaterThan(passOnlyBranch);
  });
});
