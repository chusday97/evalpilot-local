import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface WorkflowDispatchInput {
  description?: string;
  required?: boolean;
  default?: unknown;
  type?: string;
  options?: string[];
}

interface WorkflowDocument {
  name?: string;
  on?: Record<string, unknown>;
  jobs?: Record<string, {
    environment?: string | { name?: string; deployment?: boolean };
    env?: Record<string, string>;
    steps?: Array<{
      name?: string;
      if?: string;
      uses?: string;
      run?: string;
      env?: Record<string, string>;
      with?: Record<string, unknown>;
    }>;
  }>;
}

async function workflow(): Promise<WorkflowDocument> {
  const source = await readFile(resolve('.github/workflows/connected-aquaguide-blind-smoke.yml'), 'utf8');
  return parse(source) as WorkflowDocument;
}

describe('connected AquaGuide Blind Smoke workflow safety', () => {
  it('is manual-only and defaults to one bounded DeepSeek smoke', async () => {
    const document = await workflow();
    expect(document.name).toBe('Connected AquaGuide Blind Smoke');
    expect(Object.keys(document.on ?? {})).toEqual(['workflow_dispatch']);

    const dispatch = document.on?.workflow_dispatch as { inputs?: Record<string, WorkflowDispatchInput> };
    const inputs = dispatch.inputs ?? {};
    expect(inputs.confirm_paid_calls).toEqual(expect.objectContaining({ required: true, type: 'string' }));
    expect(inputs.target_app_commit).toEqual(expect.objectContaining({
      required: true,
      type: 'string',
      default: '8663b469c50605529367daf1b69ac0cd7cfb0cac',
    }));
    expect(inputs.model).toEqual(expect.objectContaining({ required: true, type: 'string', default: 'deepseek-v4-flash' }));
    expect(inputs.max_steps?.options).toEqual(['10', '12', '15']);
    expect(inputs.runs).toBeUndefined();
    expect(inputs.allow_screenshot).toBeUndefined();
  });

  it('reuses the protected environment, parameterizes the exact target commit, and does not expose the DeepSeek key job-wide', async () => {
    const document = await workflow();
    const job = document.jobs?.['connected-aquaguide-blind-smoke'];
    expect(job?.environment).toEqual({ name: 'connected-model-calibration', deployment: false });
    expect(job?.env?.EVALPILOT_AI_PROVIDER).toBe('deepseek');
    expect(job?.env?.EVALPILOT_DEEPSEEK_API_KEY).toBeUndefined();
    expect(job?.env?.EVALPILOT_OPENAI_API_KEY).toBeUndefined();
    expect(job?.env?.TARGET_APP_COMMIT).toBe('${{ inputs.target_app_commit }}');

    const steps = job?.steps ?? [];
    const checkout = steps.find((step) => step.name === 'Checkout pinned AquaGuide');
    expect(checkout?.with?.ref).toBe('${{ inputs.target_app_commit }}');

    const secretSteps = steps.filter((step) => step.env?.EVALPILOT_DEEPSEEK_API_KEY);
    expect(secretSteps.map((step) => step.name)).toEqual([
      'Confirm remote-call authorization',
      'Record no-call preflight',
      'Run connected AquaGuide Blind Smoke',
    ]);
    for (const step of secretSteps) {
      expect(step.env?.EVALPILOT_DEEPSEEK_API_KEY).toContain('secrets.EVALPILOT_CALIBRATION_DEEPSEEK_API_KEY');
      expect(step.env?.EVALPILOT_DEEPSEEK_API_KEY).not.toContain('secrets.EVALPILOT_DEEPSEEK_API_KEY');
    }
  });

  it('checks main, exact paid authorization, target SHA shape, and the secret before checkout or any provider call', async () => {
    const document = await workflow();
    const steps = document.jobs?.['connected-aquaguide-blind-smoke']?.steps ?? [];
    const authorizationIndex = steps.findIndex((step) => step.name === 'Confirm remote-call authorization');
    const checkoutIndex = steps.findIndex((step) => step.name === 'Checkout EvalPilot');
    const preflightIndex = steps.findIndex((step) => step.name === 'Record no-call preflight');
    const remoteIndex = steps.findIndex((step) => step.name === 'Run connected AquaGuide Blind Smoke');
    expect(authorizationIndex).toBe(0);
    expect(authorizationIndex).toBeLessThan(checkoutIndex);
    expect(authorizationIndex).toBeLessThan(preflightIndex);
    expect(preflightIndex).toBeLessThan(remoteIndex);
    expect(steps[authorizationIndex]?.run).toContain('refs/heads/main');
    expect(steps[authorizationIndex]?.run).toContain('RUN_CONNECTED_AQUAGUIDE_BLIND_SMOKE');
    expect(steps[authorizationIndex]?.run).toContain('EVALPILOT_DEEPSEEK_API_KEY');
    expect(steps[authorizationIndex]?.run).toContain('TARGET_APP_COMMIT');
    expect(steps[authorizationIndex]?.run).toContain('^[0-9a-f]{40}$');
  });

  it('validates a zero-call pinned preflight before the paid real-product run', async () => {
    const document = await workflow();
    const steps = document.jobs?.['connected-aquaguide-blind-smoke']?.steps ?? [];
    const preflightIndex = steps.findIndex((step) => step.name === 'Record no-call preflight');
    const validationIndex = steps.findIndex((step) => step.name === 'Validate no-call preflight');
    const remoteIndex = steps.findIndex((step) => step.name === 'Run connected AquaGuide Blind Smoke');
    expect(preflightIndex).toBeLessThan(validationIndex);
    expect(validationIndex).toBeLessThan(remoteIndex);
    expect(steps[preflightIndex]?.run).toContain('npm run --silent smoke:connected-aquaguide');
    expect(steps[preflightIndex]?.run).toContain('--preflight');
    expect(steps[validationIndex]?.run).toContain('preflight.remoteCallsMade !== false');
    expect(steps[validationIndex]?.run).toContain("preflight.provider?.provider !== 'deepseek'");
    expect(steps[validationIndex]?.run).toContain('TARGET_APP_COMMIT');
    expect(steps[validationIndex]?.run).toContain('allowScreenshotToProvider !== false');
  });

  it('treats protocol integrity as the hard gate and always uploads behavior evidence', async () => {
    const document = await workflow();
    const steps = document.jobs?.['connected-aquaguide-blind-smoke']?.steps ?? [];
    const remoteIndex = steps.findIndex((step) => step.name === 'Run connected AquaGuide Blind Smoke');
    const validationIndex = steps.findIndex((step) => step.name === 'Validate connected smoke protocol');
    const uploadIndex = steps.findIndex((step) => step.name === 'Upload connected AquaGuide evidence');
    expect(remoteIndex).toBeLessThan(validationIndex);
    expect(validationIndex).toBeLessThan(uploadIndex);
    expect(steps[validationIndex]?.run).toContain("result.analysisMode !== 'connected_aquaguide_blind_smoke'");
    expect(steps[validationIndex]?.run).toContain('result.protocolHealthy !== true');
    expect(steps[validationIndex]?.run).not.toContain('allProductJourneysPassed');

    const upload = steps[uploadIndex];
    expect(upload).toEqual(expect.objectContaining({ if: 'always()', uses: 'actions/upload-artifact@v4' }));
    expect(upload?.with?.path).toContain('connected-aquaguide-preflight.json');
    expect(upload?.with?.path).toContain('connected-aquaguide-result.json');
    expect(upload?.with?.path).toContain('connected-aquaguide-blind-output/');
  });

  it('uses the real provider and records provider errors without confusing them with product verdicts', async () => {
    const source = await readFile(resolve('scripts/run-connected-aquaguide-blind-smoke.ts'), 'utf8');
    expect(source).toContain('configuredEvaluationProvider()');
    expect(source).toContain('new AuditedProvider(baseProvider, providerAudits)');
    expect(source).not.toContain('MockAiProvider');
    expect(source).toContain("error instanceof AiProviderError ? 'provider_failure' : 'error'");
    expect(source).toContain('outcome.runtimeFailureSource');
    expect(source).toContain("runtimeFailureSource === 'provider'");
    expect(source).toContain("schemaName === 'agent_decision'");
    expect(source).toContain("schemaName === 'semantic_judge_result'");
    expect(source).toContain('actorOracleLeakCount === 0');
    expect(source).toContain('allowScreenshotToProvider: false');
    expect(source).toContain("arg('--max-steps', '12')");
  });

  it('blocks dependent journeys after an upstream non-pass and exposes per-journey progress on stderr', async () => {
    const source = await readFile(resolve('scripts/run-connected-aquaguide-blind-smoke.ts'), 'utf8');
    expect(source).toContain("['blind-record-existing-livestock', 'blind-create-usable-aquarium']");
    expect(source).toContain("['blind-daily-check-risk', 'blind-record-existing-livestock']");
    expect(source).toContain("executionStatus: 'blocked_prerequisite'");
    expect(source).toContain('if (prerequisiteCaseId && !passedCaseIds.has(prerequisiteCaseId))');
    expect(source).toContain('prerequisiteCascadeGuard: true');
    expect(source).toContain('[connected-aquaguide] START');
    expect(source).toContain('[connected-aquaguide] END');
    expect(source).toContain('[connected-aquaguide] BLOCKED');
  });
});