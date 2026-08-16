# Connected-model calibration observations

This document records empirical observations from real connected-model calibration runs. It is evidence, not an acceptance-threshold specification and not a Product Badcase register.

## 2026-08-16 — First DeepSeek cohort

### Frozen cohort identity

- Provider: `deepseek`
- Model: `deepseek-v4-flash`
- Repository SHA: `4a55e96d3f55e2395d446cedbc420377d122389b`
- Probe suite: version `2`
- Probe-suite fingerprint: `3b3800a2eca1a4505c2e88b1bce71f00618142aea18d4e1893fe088a6d1c66f5`
- `maxSteps`: `6`
- Screenshots sent to provider: `false`
- Baseline cohort: `runs=1`
- Repeated cohort: `runs=3`

The baseline and repeated cohort used the same provider/model, probe-suite fingerprint, execution configuration, and repository SHA.

### Aggregate evidence

Across the baseline plus the 3-run cohort:

- Independent calibration runs: `4`
- Probe executions: `12`
- Provider failures: `0 / 12`
- Non-provider evaluator failures: `0 / 12`
- Required probe signals preserved: `12 / 12`
- Expected verdicts preserved: `12 / 12`
- Exact signal-set matches: `11 / 12`
- Clean-path Actor drift: `0`

These counts are descriptive. They do not establish a production acceptance threshold or human-usability claim.

## Observation: `dead_end_actor_backtrack_overlap`

One `objective-dead-end` execution in the 3-run cohort differed from the dominant action sequence.

Dominant sequence (`2 / 3` in the repeated cohort):

```text
click → abandon
```

Observed variant (`1 / 3`):

```text
click → back → abandon
```

The required signals remained present in every repeated execution:

- `journey_breakpoint`: `3 / 3`
- `abandonment_risk`: `3 / 3`

The backtracking variant also emitted:

- `path_efficiency_issue`: `1 / 3`

The expected functional verdict remained `inconclusive` in all three executions.

### Current interpretation

Status: **watch; no production fix**.

The extra signal is behavior-explained: the connected Actor explicitly attempted a browser-level `back` after reaching a visible dead end, then abandoned when that recovery attempt did not produce a usable path. The current detector intentionally treats explicit Actor backtracking as path-efficiency evidence.

This observation therefore does **not** currently demonstrate:

- a DeepSeek provider failure;
- an evaluator/runtime failure;
- a confirmed detector false positive;
- a Product Failure.

The leading hypothesis is a probe/signal-boundary ambiguity: a realistic recovery attempt from a dead end may legitimately co-exist with `path_efficiency_issue`, while the current controlled ground truth lists only the two required dead-end signals.

### Decision

Do not change the Actor prompt, `friction-detector.ts`, or the production signal schema from this single observed variant.

Do not add a dead-end-specific suppression rule merely to restore a 100% exact signal-set match. That would risk hiding legitimate backtracking behavior in real Blind Experience runs.

Preserve this observation as regression evidence so future refactors continue to expose:

- required-signal preservation;
- extra-signal frequency;
- action-sequence variance;
- provider failure separately from evaluator failure.

### Next evidence gate

Run a `runs=5` cohort under the same provider/model, probe-suite fingerprint, `maxSteps=6`, and screenshot policy before changing the signal contract.

If the backtracking overlap repeats often enough to look systematic, consider whether controlled-probe ground truth should distinguish concepts such as:

```text
requiredTypes
allowedTypes
forbiddenTypes
```

That schema change is intentionally deferred until repeated evidence justifies it.
