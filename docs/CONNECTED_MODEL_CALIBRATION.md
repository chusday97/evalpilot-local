# Connected-model calibration runbook

This runbook is for maintainers collecting the first real connected-model calibration evidence. It is intentionally separate from normal CI because it can make paid remote-model calls.

## What this workflow is for

The controlled probe suite answers a narrow question: how does one configured provider/model behave on the same fingerprinted Blind Experience probes across repeated runs?

It does **not** establish general UX accuracy, user satisfaction, or a production-wide pass/fail score.

The workflow preserves:

- the no-call preflight JSON;
- every raw per-run calibration artifact;
- the aggregate variance artifact;
- provider/model identity;
- probe-suite version and fingerprint;
- execution config (`maxSteps`, screenshot policy);
- provider failures and evaluator failures as separate availability signals.

## Current calibration provider

The maintainer workflow is currently pinned to **DeepSeek** because that is the provider used for the first real cohort.

The runtime credential path is:

- `EVALPILOT_AI_PROVIDER=deepseek`
- `EVALPILOT_DEEPSEEK_API_KEY` (injected from the dedicated environment secret)
- `EVALPILOT_DEEPSEEK_MODEL`

The default workflow model is `deepseek-v4-flash`. The operator may intentionally select another currently supported DeepSeek model, but a different model is a different calibration cohort.

The general EvalPilot provider connection code still supports session-based OpenAI, DeepSeek, Kimi, and OpenAI-compatible services. The connected-model GitHub Actions workflow is deliberately narrower: it should collect one trustworthy provider/model cohort before the experiment matrix is broadened.

## Protected GitHub environment

The paid calibration job references this dedicated GitHub Environment:

```text
connected-model-calibration
```

The job uses `deployment: false`: this keeps environment protection rules and environment secrets without creating deployment-history noise for a calibration/test job.

Configure the environment in repository **Settings → Environments → connected-model-calibration** before the first real run.

Recommended protection:

1. Add a **Required reviewer** for the environment.
2. If this repository currently has only one maintainer, allow that maintainer to approve their own run. Enable “prevent self-review” only after there is a second trusted reviewer.
3. Restrict environment deployment branches/tags to `main` if the repository UI offers that rule.

The workflow also contains an independent runtime guard that rejects any calibration run whose ref is not `refs/heads/main`.

## Required environment secret

Store the DeepSeek key as an **Environment secret**, not as the repository-wide calibration credential.

Inside **Settings → Environments → connected-model-calibration → Environment secrets**, add:

```text
EVALPILOT_CALIBRATION_DEEPSEEK_API_KEY
```

Use the DeepSeek API key value as the secret value.

The workflow maps that environment-only name to the runtime variable `EVALPILOT_DEEPSEEK_API_KEY`. The calibration code therefore does not need to know how the secret is scoped in GitHub.

### Migration from the old repository secret

If the repository currently contains this older Repository Secret:

```text
EVALPILOT_DEEPSEEK_API_KEY
```

migrate before the first paid run:

1. Create/configure the `connected-model-calibration` Environment.
2. Add the environment secret `EVALPILOT_CALIBRATION_DEEPSEEK_API_KEY` using the DeepSeek key from its original source.
3. Confirm the environment secret appears in the environment settings.
4. Delete the old repository-level `EVALPILOT_DEEPSEEK_API_KEY` secret.

GitHub does not reveal a stored secret value after it has been saved. If the original key value is no longer available, create/rotate a DeepSeek key rather than trying to recover it from GitHub.

The workflow does not reference the old repository-secret name after this migration.

## Environment provider selection

Environment credentials support both OpenAI and DeepSeek for developer/maintainer execution.

If exactly one environment credential exists, EvalPilot uses that provider. If multiple provider credentials exist at the same time, EvalPilot does **not** guess: set `EVALPILOT_AI_PROVIDER=openai` or `EVALPILOT_AI_PROVIDER=deepseek` explicitly.

The calibration workflow always sets `EVALPILOT_AI_PROVIDER=deepseek`, so an unrelated OpenAI environment credential cannot silently change the cohort identity.

## Safety gates

The workflow is `workflow_dispatch` only. It does not run on push, pull request, schedule, or normal CI.

Before remote calls can start, all of these must hold:

1. the selected ref is `main`;
2. the `connected-model-calibration` environment protection rules have passed;
3. the operator typed this exact acknowledgement:

```text
RUN_CONNECTED_MODEL_CALIBRATION
```

4. the environment secret `EVALPILOT_CALIBRATION_DEEPSEEK_API_KEY` is available;
5. the zero-call preflight parses successfully and reports:
   - `status = ready`
   - `canRun = true`
   - `remoteCallsMade = false`
   - `provider.providerId = deepseek`

If any workflow-side check fails, calibration stops before the paid calibration command.

Screenshots are **disabled by default**. Enable them only when the experiment explicitly requires visual input and the controlled probe screenshots are authorized for remote transmission.

## Recommended first cohort

Start with the smallest evidence-producing run:

- provider: `deepseek`;
- model: `deepseek-v4-flash` unless another model is intentionally selected;
- runs: `1`;
- max steps: `6`;
- screenshots: `false`.

Inspect that artifact before increasing repetitions. The first run is a protocol and evidence sanity check, not a variance estimate.

If the raw artifact is structurally valid and failure attribution is trustworthy, run the **same provider + same model + same probe-suite fingerprint + same execution config** with `3` or `5` repetitions.

Do not change the model, max-step budget, screenshot policy, or probe suite midway through a variance cohort.

## How to run it

1. Confirm the protected Environment and Environment Secret are configured.
2. Open GitHub Actions.
3. Select **Connected Model Calibration**.
4. Choose **Run workflow** on `main`.
5. Enter `RUN_CONNECTED_MODEL_CALIBRATION` in the authorization field.
6. Keep `deepseek-v4-flash` or intentionally enter the DeepSeek model ID for this cohort.
7. Select repetitions, max steps, and screenshot policy.
8. Start the workflow.
9. If the environment uses Required reviewers, approve the waiting job from the workflow run page.
10. Download the `connected-model-calibration-<run-id>-<attempt>` artifact after completion.

## Artifact structure

The uploaded GitHub Actions artifact contains:

```text
connected-model-preflight.json
connected-model-result.json
connected-model-artifacts/
└── connected-model-<session-id>/
    ├── connected-model-variance.json
    ├── connected-model-calibration.json   # single-run compatibility artifact when runs=1
    └── runs/
        └── run-XXX/
            └── connected-model-calibration.json
```

The run directories also retain the underlying browser/evidence output produced by each controlled probe.

## What to inspect first

For the first real run, inspect in this order:

1. `provider.providerId` is `deepseek` and `provider.model` is the intended model.
2. `probeSuite.version` and `probeSuite.fingerprint` are present.
3. `executionConfig` matches the operator inputs.
4. `providerFailureCount` and `evaluatorFailureCount` are interpreted separately.
5. Raw rows and action sequences are plausible before looking at aggregate means.
6. Clean-probe extra signals are treated as possible Actor drift, not automatic product defects.

If the run has evaluator failures, investigate evaluator/runtime evidence before interpreting UX detector metrics. If it has provider failures, treat those as provider/model availability evidence rather than detector false negatives.

## Cohort comparison rules

Variance aggregation is valid only when all samples share:

1. the same `providerId + model`;
2. the same probe-suite `version + fingerprint`;
3. the same execution config.

Different models should be separate cohorts. Never pool different models into one average and call the result model variance.

Likewise, changing the probe suite or run budget creates a new experimental condition. Keep the previous raw artifacts instead of rewriting history.

## Decision after the first real cohort

Do not tune thresholds from one run. Use the first valid repeated cohort to decide which layer actually needs work:

- **Provider/model** — repeated provider failures or materially unstable structured behavior;
- **Actor policy** — unstable or implausible action sequences on the same probe;
- **Evaluator/runtime** — evaluator failures, evidence loss, grounding, or browser instability;
- **Detector boundary** — stable Actor behavior but systematic extra/missing friction signals;
- **Task/probe definition** — ambiguous ground truth or a probe that does not isolate the intended behavior.

Only after that attribution should the corresponding layer be changed.
