import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateRealProductAcceptance, loadRealProductAcceptanceManifest } from '../src/acceptance/real-product-acceptance.js';

const readyFoundation = { quality: 'ready', warnings: [] };

const scenario = (caseId: string, goal: string) => ({
  caseId,
  goal,
  startingUrl: 'http://localhost:3000/aquarium',
});

const result = (caseId: string, verdict: 'pass' | 'fail' | 'inconclusive', failureSource: string | null, summary: string) => ({
  caseId,
  verdict,
  failureSource,
  semantic: { summary },
});

describe('real product acceptance gate', () => {
  it('loads the pinned AquaGuide acceptance manifest and requires three real tasks', async () => {
    const manifest = await loadRealProductAcceptanceManifest(resolve('acceptance/real-products/aquaguide.yaml'));
    expect(manifest.product.repository).toBe('chusday97/aquaguide-tank-guide');
    expect(manifest.product.commit).toBe('8663b469c50605529367daf1b69ac0cd7cfb0cac');
    expect(manifest.tasks.map((task) => task.acceptanceTaskId)).toEqual([
      'aqua-create-usable-freshwater-tank',
      'aqua-record-existing-livestock',
      'aqua-daily-check-risk-triage',
    ]);
    expect(manifest.thresholds.requiredPasses).toBe(3);
  });

  it('passes only when all three matched AquaGuide tasks have real Judge PASS results', async () => {
    const manifest = await loadRealProductAcceptanceManifest(resolve('acceptance/real-products/aquaguide.yaml'));
    const gate = evaluateRealProductAcceptance({
      manifest,
      foundationQuality: readyFoundation,
      preflight: {
        blockedCaseIds: [],
        prerequisitePlans: [],
        scenarios: [
          scenario('case-create', '创建新的鱼缸'),
          scenario('case-record', '记录已有生物到当前鱼缸'),
          scenario('case-daily', '完成每日检查并查看风险'),
        ],
      },
      report: {
        caseResults: [
          result('case-create', 'pass', null, '可用鱼缸已创建。'),
          result('case-record', 'pass', null, '生物记录已保存。'),
          result('case-daily', 'pass', null, '每日检查已生成高风险结果。'),
        ],
      },
    });

    expect(gate.passed).toBe(true);
    expect(gate.taskCompletionRate).toBe(1);
    expect(gate.counts).toMatchObject({ planned: 3, passed: 3, evaluatorFailures: 0, prerequisiteBlocks: 0, notRun: 0 });
    expect(gate.failedThresholds).toEqual([]);
  });

  it('separates prerequisite blocks and evaluator failures instead of hiding them inside completion', async () => {
    const manifest = await loadRealProductAcceptanceManifest(resolve('acceptance/real-products/aquaguide.yaml'));
    const gate = evaluateRealProductAcceptance({
      manifest,
      foundationQuality: readyFoundation,
      preflight: {
        blockedCaseIds: ['case-record'],
        prerequisitePlans: [{
          caseId: 'case-record',
          status: 'blocked',
          reasons: ['Setup: 需要已有鱼缸'],
          unresolvedBlockers: [{ type: 'needs_setup', summary: '需要已有鱼缸', sourceValue: 'existing aquarium' }],
        }],
        scenarios: [
          scenario('case-create', '创建新的鱼缸'),
          scenario('case-record', '记录已有生物到当前鱼缸'),
          scenario('case-daily', '完成每日检查并查看风险'),
        ],
      },
      report: {
        caseResults: [
          result('case-create', 'pass', null, '可用鱼缸已创建。'),
          result('case-daily', 'inconclusive', 'evaluator', 'Agent 没有完成每日检查。'),
        ],
      },
    });

    expect(gate.passed).toBe(false);
    expect(gate.taskCompletionRate).toBeCloseTo(1 / 3);
    expect(gate.counts).toMatchObject({ passed: 1, prerequisiteBlocks: 1, evaluatorFailures: 1 });
    expect(gate.tasks.find((task) => task.acceptanceTaskId === 'aqua-record-existing-livestock')?.status).toBe('prerequisite_blocked');
    expect(gate.tasks.find((task) => task.acceptanceTaskId === 'aqua-daily-check-risk-triage')?.status).toBe('evaluator_failure');
  });

  it('fails at Foundation when product understanding is degraded, before blaming the product', async () => {
    const manifest = await loadRealProductAcceptanceManifest(resolve('acceptance/real-products/aquaguide.yaml'));
    const gate = evaluateRealProductAcceptance({
      manifest,
      foundationQuality: { quality: 'degraded', warnings: ['deterministic fallback'] },
      preflight: { blockedCaseIds: [], prerequisitePlans: [], scenarios: [] },
      report: { caseResults: [] },
    });

    expect(gate.passed).toBe(false);
    expect(gate.counts.foundationBlocked).toBe(3);
    expect(gate.counts.productFailures).toBe(0);
    expect(gate.counts.evaluatorFailures).toBe(0);
  });
});
