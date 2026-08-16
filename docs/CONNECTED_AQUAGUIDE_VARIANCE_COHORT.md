# Connected AquaGuide 3-Run Variance Cohort

This phase starts only after the single-run Connected Real-Product Smoke reached a complete post-fix baseline. Its purpose is no longer to ask whether the connected path can run at all. It asks whether the same frozen product/model/evaluator configuration produces stable outcomes and what kinds of behavioral variance recur.

## Frozen configuration

The cohort is exactly three sequential runs under one explicit paid authorization:

- EvalPilot workflow source: `main`
- pinned AquaGuide: `8663b469c50605529367daf1b69ac0cd7cfb0cac`
- provider: `deepseek`
- default model: `deepseek-v4-flash`
- default max Blind Actor steps: `12`
- Playwright locale: `en-US`
- AquaGuide application locale: `en`
- screenshots to provider: disabled
- journeys: create aquarium → record livestock → Daily Check
- prerequisite cascade guard: enabled

There is deliberately no workflow `run_count` input. The authorization string `RUN_CONNECTED_AQUAGUIDE_3_RUN_COHORT` means exactly three paid connected repetitions.

Runs are sequential, not a GitHub Actions matrix. Each smoke invocation creates a fresh browser context and a separate output directory while reusing the same pinned local AquaGuide server. This avoids concurrent state interference and makes run order explicit.

## What the aggregator measures

The deterministic aggregator reads the three raw `connected_aquaguide_blind_smoke` JSON results and produces both JSON and Markdown. It does not call a model.

### Run-level metrics

- protocol-healthy run count
- full-product-pass run count
- provider-failure run count
- evaluator-failure run count
- unknown-attribution run count
- prerequisite-blocked run count
- Actor Oracle leak total
- Judge Oracle visibility across all runs
- runs containing pre-failure signals

A provider or evaluator failure is an observed incidence, not an aggregator crash. The cohort workflow should remain analyzable when a run is `inconclusive` or a dependent journey is `blocked_prerequisite`.

### Journey-level metrics

For each case:

- completed-pass count and completion rate
- verdict distribution
- execution-status distribution
- runtime-failure distribution
- outcome stability
- distinct action-path count and action-path stability
- action-count min / mean / max
- number of runs with backtracking
- number of runs with Actor retry behavior
- number of runs with repeated input
- friction recurrence by run
- finding recurrence by run
- pre-failure signal recurrence by run

Recurrence is counted by **run**, not raw duplicate occurrences inside one run. For example, two identical pointer-interception events inside one run count as recurrence in one run, not two independent reproductions.

## Contract health vs evaluation outcomes

The workflow fails only when the cohort contract itself is invalid, for example:

- fewer than three complete smoke JSON results
- target product commit drift
- provider/model drift
- max-step drift
- locale drift
- screenshots unexpectedly enabled
- Actor Oracle leakage or required Judge Oracle visibility violation

It does **not** fail merely because:

- a product journey fails
- a provider timeout survives its retry budget
- an evaluator runtime failure occurs
- a prerequisite blocks a downstream journey
- action paths differ between runs
- a UX finding recurs

Those are the measurements the cohort exists to preserve.

## Interpretation boundary

Three runs are still a small descriptive cohort. Values such as `1/3` or `2/3` must not be presented as true probabilities or population failure rates. Repetition increases evidence about recurrence under this exact benchmark configuration, but it is not a human usability study.

A recurring Playwright `pointer_interception` signal remains evidence at the product/evaluator interaction boundary unless separate evidence establishes human-user impact.

Current provider audit also records final logical-request status rather than internal retry attempts. The cohort can measure terminal provider-failure incidence, but it cannot estimate timeout-retry recovery frequency until attempt-level transport telemetry exists.

## Paid-run gate

Do not trigger the cohort while changing model, prompt, max steps, locale, product commit, or journey definitions. Those would create a different experiment.

First merge and validate this harness with zero-call CI. A later three-run execution requires a fresh explicit paid authorization; prior Smoke #1–#5 approvals do not carry over.
