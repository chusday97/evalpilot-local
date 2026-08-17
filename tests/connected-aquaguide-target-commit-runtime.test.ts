import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

describe('connected AquaGuide target commit runtime contract', () => {
  it('uses the workflow target commit as the runtime source of truth', async () => {
    const [script, workflowSource] = await Promise.all([
      readFile(resolve('scripts/run-connected-aquaguide-blind-smoke.ts'), 'utf8'),
      readFile(resolve('.github/workflows/connected-aquaguide-blind-smoke.yml'), 'utf8'),
    ]);
    const workflow = parse(workflowSource) as {
      on?: { workflow_dispatch?: { inputs?: Record<string, { default?: unknown }> } };
      jobs?: Record<string, { env?: Record<string, string>; steps?: Array<{ name?: string; with?: Record<string, unknown> }> }>;
    };
    const job = workflow.jobs?.['connected-aquaguide-blind-smoke'];
    const checkout = job?.steps?.find((step) => step.name === 'Checkout pinned AquaGuide');

    expect(workflow.on?.workflow_dispatch?.inputs?.target_app_commit?.default)
      .toBe('2add55a54402afc18b642b572d8ee8351ab72c53');
    expect(job?.env?.TARGET_APP_COMMIT).toBe('${{ inputs.target_app_commit }}');
    expect(checkout?.with?.ref).toBe('${{ inputs.target_app_commit }}');

    expect(script).toContain("const pinnedCommit = (process.env.TARGET_APP_COMMIT ?? defaultPinnedCommit).trim();");
    expect(script).toContain("throw new Error('TARGET_APP_COMMIT must be an exact 40-character lowercase Git SHA.');");
    expect(script).toContain('targetAppGitSha: pinnedCommit');
    expect(script).not.toContain('8663b469c50605529367daf1b69ac0cd7cfb0cac');
  });
});
