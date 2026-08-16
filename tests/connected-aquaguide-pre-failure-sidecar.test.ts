import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

describe('connected AquaGuide pre-failure evidence sidecar', () => {
  it('enriches the paid smoke result before protocol validation without another provider call', async () => {
    const workflowSource = await readFile(resolve('.github/workflows/connected-aquaguide-blind-smoke.yml'), 'utf8');
    const workflow = parse(workflowSource) as {
      jobs?: Record<string, { steps?: Array<{ name?: string; run?: string; env?: Record<string, string> }> }>;
    };
    const steps = workflow.jobs?.['connected-aquaguide-blind-smoke']?.steps ?? [];
    const remoteIndex = steps.findIndex((step) => step.name === 'Run connected AquaGuide Blind Smoke');
    const enrichIndex = steps.findIndex((step) => step.name === 'Preserve pre-failure action evidence');
    const validationIndex = steps.findIndex((step) => step.name === 'Validate connected smoke protocol');

    expect(remoteIndex).toBeGreaterThanOrEqual(0);
    expect(enrichIndex).toBeGreaterThan(remoteIndex);
    expect(validationIndex).toBeGreaterThan(enrichIndex);
    expect(steps[enrichIndex]?.run).toContain('enrich-connected-aquaguide-pre-failure-signals.ts');
    expect(steps[enrichIndex]?.env?.EVALPILOT_DEEPSEEK_API_KEY).toBeUndefined();
    expect(steps[validationIndex]?.run).toContain('observedPreFailureSignals');
    expect(steps[validationIndex]?.run).toContain('schemaVersion < 3');
  });

  it('keeps pre-failure action evidence diagnostic-only', async () => {
    const source = await readFile(resolve('scripts/enrich-connected-aquaguide-pre-failure-signals.ts'), 'utf8');
    expect(source).toContain('collectObservedPreFailureSignals');
    expect(source).toContain('taskResult.observedPreFailureSignals = signals');
    expect(source).toContain('preFailureSignalCount');
    expect(source).toContain('do not independently change the journey verdict or runtimeFailureSource');
    expect(source).not.toContain('verdict =');
    expect(source).not.toContain('runtimeFailureSource =');
  });
});
