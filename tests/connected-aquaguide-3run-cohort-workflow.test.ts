import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflowPath = '.github/workflows/connected-aquaguide-3run-cohort.yml';

describe('Connected AquaGuide 3-run cohort workflow', () => {
  it('keeps paid execution manual, fixed to three sequential runs, and protected', async () => {
    const workflow = await readFile(workflowPath, 'utf8');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('RUN_CONNECTED_AQUAGUIDE_3_RUN_COHORT');
    expect(workflow).toContain("COHORT_RUN_COUNT: '3'");
    expect(workflow).not.toContain('run_count:');
    expect(workflow).not.toContain('matrix:');
    expect(workflow).toContain('environment:\n      name: connected-model-calibration');
    expect(workflow).toContain('if [[ "$GITHUB_REF" != "refs/heads/main" ]]');
    expect(workflow).toContain('for run_index in $(seq 1 "$COHORT_RUN_COUNT")');
    expect(workflow).toContain('--output "connected-aquaguide-cohort-output/run-${run_index}"');
    expect(workflow).toContain('EVALPILOT_CALIBRATION_DEEPSEEK_API_KEY');
    expect(workflow).toContain('allowScreenshotToProvider !== false');
  });

  it('aggregates all three raw smoke results and gates contract health rather than product outcomes', async () => {
    const workflow = await readFile(workflowPath, 'utf8');

    expect(workflow).toContain('--input connected-aquaguide-cohort-run-1.json');
    expect(workflow).toContain('--input connected-aquaguide-cohort-run-2.json');
    expect(workflow).toContain('--input connected-aquaguide-cohort-run-3.json');
    expect(workflow).toContain("summary.analysisMode !== 'connected_aquaguide_3_run_variance_cohort'");
    expect(workflow).toContain('summary.runCount !== 3');
    expect(workflow).toContain('summary.boundaryHealthy !== true');
    expect(workflow).not.toContain('summary.fullPassRunCount !== 3');
    expect(workflow).not.toContain('summary.protocolHealthyRunCount !== 3');
    expect(workflow).toContain('if: always()');
    expect(workflow).toContain('connected-aquaguide-cohort-summary.md');
  });
});
