# Connected AquaGuide Daily-only retest

Date: 2026-08-17

## Purpose

This retest is a narrow follow-up to connected AquaGuide Run #10.

It executes the existing EvalCase `blind-daily-check-risk` only. It does not rerun Create Aquarium or Record Livestock with the model.

The retest has two evidence goals:

1. same-case connected confirmation for PUI-BC-023: the blind Actor should enter the real Daily Check rather than Care Guide / Quick Check;
2. end-to-end confirmation for PUI-BC-024: `经常浮头` with otherwise normal water observations must produce the breathing-only warning rather than falsely claiming observed water abnormality.

## Deterministic local setup

The browser receives a returning-user aquarium state through `aquarium_app_state_v1` before navigation.

The setup shape is derived from AquaGuide's GP-003 returning-user Daily Check fixture:

- one configured 60×30×30 Freshwater aquarium;
- at least one stocked species;
- onboarding already complete;
- no existing diagnosis / Daily Check record.

This setup makes zero EvalPilot provider calls. It substitutes only the upstream prerequisites; it does not complete the evaluated Daily task.

Before any paid evaluation call, the no-call preflight launches a real Chromium page against the pinned AquaGuide build and requires the Daily task to be visible, the seeded aquarium to be active, zero pre-existing diagnosis records, and no page errors.

## Remote-call boundary

Workflow: `Connected AquaGuide Daily Blind Retest`

It is `workflow_dispatch` only and requires the exact authorization string:

`RUN_CONNECTED_AQUAGUIDE_DAILY_RETEST`

The workflow must not be triggered automatically.

Screenshots remain disabled for the provider.

Within the one Daily journey, remote calls may include Actor decisions, semantic step verification / reflection, and the final semantic Judge. The cost reduction comes from eliminating all remote calls for the Create Aquarium and Record Livestock prerequisite journeys, not from claiming that the Daily journey itself is only two model requests.

The no-call preflight must report:

- one case only: `blind-daily-check-risk`;
- `journeyMode = daily_only`;
- `prerequisiteRemoteCalls = 0`;
- `remoteCallsMade = false`;
- real-browser setup validation = ready;
- exact pinned AquaGuide SHA.

## Product assertions

The retained Daily case still requires the saved high-risk Daily state:

- `Act now`;
- `Do this first`;
- `已保存今天的检查记录。`.

PUI-BC-024 adds:

- visible breathing-only summary:
  `经常浮头或呼吸明显急促需要优先按缺氧、水温或过滤异常排查。`
- absent false water-abnormal summary:
  `鱼浮头并伴随水体异常`
- absent water-abnormal-only action:
  `少量换水 20%-30%`

## Connected PASS gate

A successful workflow requires all of the following:

- Blind Experience analysis present;
- Actor Oracle leak count = 0;
- Judge Oracle visible;
- provider failure count = 0;
- evaluator failure count = 0;
- unknown failure count = 0;
- Agent status completed;
- Hybrid verdict = pass;
- failureSource = null;
- every deterministic Daily assertion = pass;
- semantic Judge verdict = pass;
- semantic taskCompletion = complete.

A provider timeout or evaluator interruption is not a Product Failure and cannot close PUI-BC-023.

## Lifecycle boundary

PUI-BC-024 is already product-layer `regression_verified` through deterministic product tests and AquaGuide Product Golden Path CI.

PUI-BC-023 remains open until the same EvalCase obtains a complete connected PASS. Only after that PASS may the existing badcase → Regression promotion rules be applied.

No Challenge candidate should be generated from the unresolved PUI-BC-023 state.

## Current execution status

Infrastructure only. No Daily-only remote run has been authorized or executed yet.
