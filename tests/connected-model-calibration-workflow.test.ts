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
    environment?: string | {
      name?: string;
      deployment?: boolean;
    };
    env?: Record<string, string>;
    steps?: Array<{
      name?: string;
      if?: string;
      uses?: string;
      run?: string;
      with?: Record<string, unknown>;
    }>;
  }>;
}

async function workflow(): Promise<WorkflowDocument> {
  const source = await readFile(resolve('.github/workflows/connected-model-calibration.yml'), 'utf8');
  return parse(source) as WorkflowDocument;
}

describe('connected-model calibration workflow safety', () => {
  it('is manual-only and requires an explicit paid-call acknowledgement', async () => {
    const document = await workflow();
    expect(document.name).toBe('Connected Model Calibration');
    expect(document.on).toBeDefined();
    expect(Object.keys(document.on ?? {})).toEqual(['workflow_dispatch']);

    const dispatch = document.on?.workflow_dispatch as { inputs?: Record<string, WorkflowDispatchInput> };
    const inputs = dispatch.inputs ?? {};
    expect(inputs.confirm_paid_calls).toEqual(expect.objectContaining({ required: true, type: 'string' }));
    expect(inputs.allow_screenshot).toEqual(expect.objectContaining({ required: true, type: 'boolean', default: false }));
    expect(inputs.runs?.options).toEqual(['1', '3', '5']);
    expect(inputs.model).toEqual(expect.objectContaining({
      required: true,
      type: 'string',
      default: 'deepseek-v4-flash',
    }));
  });

  it('gates the paid job behind the dedicated calibration environment', async () => {
    const document = await workflow();
    const calibrationEnvironment = document.jobs?.calibrate?.environment;

    expect(calibrationEnvironment).toEqual({
      name: 'connected-model-calibration',
      deployment: false,
    });
  });

  it('pins the maintainer calibration workflow to DeepSeek and the environment-only secret name', async () => {
    const document = await workflow();
    const environment = document.jobs?.calibrate?.env ?? {};

    expect(environment.EVALPILOT_AI_PROVIDER).toBe('deepseek');
    expect(environment.EVALPILOT_DEEPSEEK_API_KEY).toContain('secrets.EVALPILOT_CALIBRATION_DEEPSEEK_API_KEY');
    expect(environment.EVALPILOT_DEEPSEEK_API_KEY).not.toContain('secrets.EVALPILOT_DEEPSEEK_API_KEY');
    expect(environment.EVALPILOT_DEEPSEEK_MODEL).toContain('inputs.model');
    expect(environment.EVALPILOT_OPENAI_API_KEY).toBeUndefined();
  });

  it('restricts paid calibration to main and checks authorization before installing or calling the provider', async () => {
    const document = await workflow();
    const steps = document.jobs?.calibrate?.steps ?? [];
    const confirmationIndex = steps.findIndex((step) => step.name === 'Confirm remote-call authorization');
    const installIndex = steps.findIndex((step) => step.name === 'Install dependencies');
    const calibrationIndex = steps.findIndex((step) => step.name === 'Run connected-model calibration');
    expect(confirmationIndex).toBeGreaterThanOrEqual(0);
    expect(confirmationIndex).toBeLessThan(installIndex);
    expect(confirmationIndex).toBeLessThan(calibrationIndex);
    expect(steps[confirmationIndex]?.run).toContain('refs/heads/main');
    expect(steps[confirmationIndex]?.run).toContain('RUN_CONNECTED_MODEL_CALIBRATION');
    expect(steps[confirmationIndex]?.run).toContain('EVALPILOT_DEEPSEEK_API_KEY');
    expect(steps[confirmationIndex]?.run).toContain('EVALPILOT_CALIBRATION_DEEPSEEK_API_KEY');
    expect(steps[confirmationIndex]?.run).not.toContain('EVALPILOT_OPENAI_API_KEY');
  });

  it('validates a ready zero-call DeepSeek preflight before the paid calibration step', async () => {
    const document = await workflow();
    const steps = document.jobs?.calibrate?.steps ?? [];
    const preflightIndex = steps.findIndex((step) => step.name === 'Record no-call preflight');
    const validationIndex = steps.findIndex((step) => step.name === 'Validate no-call preflight');
    const calibrationIndex = steps.findIndex((step) => step.name === 'Run connected-model calibration');
    expect(preflightIndex).toBeGreaterThanOrEqual(0);
    expect(preflightIndex).toBeLessThan(validationIndex);
    expect(validationIndex).toBeLessThan(calibrationIndex);
    expect(steps[preflightIndex]?.run).toContain('--preflight');
    expect(steps[preflightIndex]?.run).toContain('npm run --silent calibrate:connected-model');
    expect(steps[validationIndex]?.run).toContain('JSON.parse');
    expect(steps[validationIndex]?.run).toContain("preflight.status !== 'ready'");
    expect(steps[validationIndex]?.run).toContain('preflight.remoteCallsMade !== false');
    expect(steps[validationIndex]?.run).toContain("preflight.provider?.providerId !== 'deepseek'");
  });

  it('captures valid DeepSeek result JSON and retains evidence even when later validation fails', async () => {
    const document = await workflow();
    const steps = document.jobs?.calibrate?.steps ?? [];
    const calibrationIndex = steps.findIndex((step) => step.name === 'Run connected-model calibration');
    const resultValidationIndex = steps.findIndex((step) => step.name === 'Validate calibration result');
    const uploadIndex = steps.findIndex((step) => step.name === 'Upload calibration evidence');
    expect(calibrationIndex).toBeGreaterThanOrEqual(0);
    expect(calibrationIndex).toBeLessThan(resultValidationIndex);
    expect(resultValidationIndex).toBeLessThan(uploadIndex);
    expect(steps[calibrationIndex]?.run).toContain('npm run --silent calibrate:connected-model');
    expect(steps[resultValidationIndex]?.run).toContain('JSON.parse');
    expect(steps[resultValidationIndex]?.run).toContain('connected_model_behavior_variance');
    expect(steps[resultValidationIndex]?.run).toContain("result.provider?.providerId !== 'deepseek'");

    const upload = steps[uploadIndex];
    expect(upload).toEqual(expect.objectContaining({
      if: 'always()',
      uses: 'actions/upload-artifact@v4',
    }));
    expect(upload?.with?.path).toContain('connected-model-preflight.json');
    expect(upload?.with?.path).toContain('connected-model-result.json');
    expect(upload?.with?.path).toContain('connected-model-artifacts/');
  });
});
