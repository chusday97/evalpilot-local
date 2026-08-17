import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AQUAGUIDE_DAILY_RETEST_ANALYSIS_MODE,
  AQUAGUIDE_DAILY_RETEST_CASE_ID,
  AQUAGUIDE_DAILY_RETEST_DEFAULT_TARGET,
  AQUAGUIDE_DAILY_RETEST_SETUP_MODE,
  buildAquaGuideDailyRetestCase,
  buildAquaGuideDailyRetestState,
} from '../src/validation/aquaguide-daily-retest-contract.js';

describe('connected AquaGuide Daily-only retest contract', () => {
  it('keeps the same Daily EvalCase while adding the PUI-BC-024 output regression', () => {
    const evalCase = buildAquaGuideDailyRetestCase();
    expect(evalCase.caseId).toBe('blind-daily-check-risk');
    expect(evalCase.caseId).toBe(AQUAGUIDE_DAILY_RETEST_CASE_ID);
    expect(evalCase.goal).toContain('鱼经常浮头');
    expect(evalCase.knownInformation).toMatchObject({
      respiration: '经常浮头',
      waterClarity: '清澈',
      surface: '没有泡沫或油膜',
      odor: '没有异味',
      behavior: '正常游动和进食',
      recentOperation: '没有特别操作',
    });

    const assertions = new Map(evalCase.oracle.deterministicAssertions.map((item) => [item.assertionId, item]));
    expect(assertions.get('blind-daily-breathing-only-summary')).toMatchObject({
      type: 'text_visible',
      target: '经常浮头或呼吸明显急促需要优先按缺氧、水温或过滤异常排查。',
    });
    expect(assertions.get('blind-daily-no-false-water-abnormal-summary')).toMatchObject({
      type: 'text_absent',
      target: '鱼浮头并伴随水体异常',
    });
    expect(assertions.get('blind-daily-no-false-water-change-action')).toMatchObject({
      type: 'text_absent',
      target: '少量换水 20%-30%',
    });
  });

  it('uses a deterministic returning-user setup with no pre-existing Daily record', () => {
    const state = buildAquaGuideDailyRetestState(new Date('2026-08-17T12:00:00.000Z')) as {
      currentAquariumId: string;
      aquariums: Array<{ dimensions: { length: string; width: string; height: string }; waterType: string; fishes: unknown[] }>;
      diagnosisRecords: unknown[];
      onboarding: { status: string; aquariumConfigured: boolean };
    };

    expect(AQUAGUIDE_DAILY_RETEST_SETUP_MODE).toBe('aquaguide_gp003_local_storage_fixture');
    expect(state.currentAquariumId).toBe('tank-connected-daily-retest');
    expect(state.aquariums).toHaveLength(1);
    expect(state.aquariums[0]).toMatchObject({
      dimensions: { length: '60', width: '30', height: '30' },
      waterType: 'Freshwater',
    });
    expect(state.aquariums[0]?.fishes.length).toBeGreaterThan(0);
    expect(state.diagnosisRecords).toEqual([]);
    expect(state.onboarding).toMatchObject({ status: 'completed', aquariumConfigured: true });
  });

  it('keeps remote execution manual, pinned, Daily-only, and screenshot-free', async () => {
    const script = await readFile(resolve('scripts/run-connected-aquaguide-daily-retest.ts'), 'utf8');
    const workflow = await readFile(resolve('.github/workflows/connected-aquaguide-daily-retest.yml'), 'utf8');

    expect(AQUAGUIDE_DAILY_RETEST_ANALYSIS_MODE).toBe('connected_aquaguide_daily_blind_retest');
    expect(AQUAGUIDE_DAILY_RETEST_DEFAULT_TARGET).toBe('3d73c033b6899e3a92144f6de99a05db8babde78');
    expect(script).toContain('runBlindExperienceCase({');
    expect(script).toContain("startingUrl: `${targetUrl}/aquarium`");
    expect(script).toContain('allowScreenshotToProvider: false');
    expect(script).toContain('prerequisiteRemoteCalls: 0');
    expect(script).not.toContain('blind-create-usable-aquarium');
    expect(script).not.toContain('blind-record-existing-livestock');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^\s+push:/m);
    expect(workflow).not.toMatch(/^\s+pull_request:/m);
    expect(workflow).not.toMatch(/^\s+schedule:/m);
    expect(workflow).toContain('RUN_CONNECTED_AQUAGUIDE_DAILY_RETEST');
    expect(workflow).toContain('default: 3d73c033b6899e3a92144f6de99a05db8babde78');
    expect(workflow).toContain('connected_aquaguide_daily_blind_retest_preflight');
    expect(workflow).toContain("JSON.stringify(['blind-daily-check-risk'])");
    expect(workflow).toContain('preflight.executionConfig?.prerequisiteRemoteCalls !== 0');
    expect(workflow).toContain('result.productJourneyPassed !== true');
    expect(workflow).toContain("result.taskResult?.semanticVerdict !== 'pass'");
  });
});
