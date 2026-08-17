# AquaGuide PUI-BC-023 Connected Closure

## Decision

PUI-BC-023 is eligible for lifecycle closure and Regression promotion after the same EvalCase `blind-daily-check-risk` produced a complete connected PASS.

## Connected retest

- GitHub Actions run: `32035944562`
- Internal EvalPilot run: `run-ai-2026-08-17T13-54-33-447Z`
- AquaGuide target: `3d73c033b6899e3a92144f6de99a05db8babde78`
- Model: `deepseek-v4-flash`
- max Actor steps: `12`
- screenshots sent to provider: `false`
- artifact: `9291145132`
- artifact SHA-256: `e12a67b59d01c9bb9c1a8d56eb9a0804e165be765c1753f2d5e2cb3f5dad8cf2`

The zero-call browser preflight confirmed the pinned target, visible Daily task, active seeded aquarium, zero existing diagnosis records, and no page errors before any provider request.

## PASS evidence

- `protocolHealthy=true`
- `productJourneyPassed=true`
- Actor Oracle leak count = `0`
- Judge Oracle visible = `true`
- provider / evaluator / unknown failure counts = `0 / 0 / 0`
- Hybrid verdict = `pass`
- `failureSource=null`
- semantic Judge = `pass + complete`, confidence `0.95`

All deterministic checks passed:

1. `blind-daily-risk` — `Act now` visible.
2. `blind-daily-action` — `Do this first` visible.
3. `blind-daily-recorded-high-risk` — saved-today confirmation visible.
4. `blind-daily-breathing-only-summary` — correct breathing-only summary visible.
5. `blind-daily-no-false-water-abnormal-summary` — false water-abnormal summary absent.
6. `blind-daily-no-false-water-change-action` — false 20%-30% water-change action absent.

The blind Actor entered the real Daily Aquarium Check on its first route, completed the six observations, generated the result, saved today's record, and finished without friction findings.

## Lifecycle consequence

The project promoter remains the authority for Regression lineage. `promoteFixedBadcaseToRegression()` requires all three conditions that now hold:

1. the Badcase is explicitly `fixed`;
2. the retest verdict is `pass` with `failureSource=null`;
3. the retest is the same source case.

The retained promotion fixture therefore produces stable Regression case `case-regression-pui-bc-023` from `blind-daily-check-risk`.

PUI-BC-024 remains a separate rule-engine root cause. Its breathing-only / forbidden-water-abnormal assertions are deliberately retained in this same end-to-end case so later product drift cannot silently reintroduce it.

## Boundary

This is evidence that the AI-blind evaluation path no longer reproduces PUI-BC-023 on the pinned product commit. It is not a human usability failure-rate estimate and is not a model reliability estimate.
