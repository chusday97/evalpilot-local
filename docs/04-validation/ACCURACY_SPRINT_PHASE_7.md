# Evaluator Accuracy Sprint — Phase 7 Validation

## Scope

Phase 7 measures the controlled evaluator pipeline; it does not add product features or claim real-model accuracy. The existing 40 precomputed fixtures remain a rule-level unit benchmark. This phase adds 10 runnable local Web apps, each executed three times with real Chromium.

## Protocol and truth boundary

1. Load the fixture definition without Ground Truth.
2. Generate the task case and bounded Product Model.
3. Run the production AI Test Agent, DOM grounding, screenshots/Trace, Hybrid Judge, Finding Triage, and Badcase gate.
4. Read the separate `ground-truth.json` only after all three predictions are complete.
5. Compare predictions with Ground Truth and persist a reviewable report.

The first benchmark uses a deterministic Mock Actor. This isolates evaluator orchestration, evidence handling, Judge output, classification, and failure-source attribution. It does not measure a remote model's ability.

## Runnable fixtures

| Fixture | Ground Truth | Main boundary |
|---|---|---|
| `clean-form` | no issue | successful form feedback |
| `dead-click` | interaction / P1 / product | click produces no result |
| `state-loss` | state / P1 / product | entered state disappears |
| `api-500` | api / P1 / product | request returns 500 |
| `duplicate-submit` | data / P1 / product | one action creates duplicate requests |
| `unclear-next-step` | ux / P2 / product | user cannot identify the next action |
| `delayed-result` | no issue | valid 900 ms result must not be timed out |
| `ai-irrelevant-output` | ai_output / P1 / product | visible answer does not satisfy the requested fact |
| `evaluator-trap` | evaluator failure | malformed Actor output must fail closed |
| `destructive-action` | evaluator failure | safety-blocked deletion must not blame the product |

## Authoritative local result

Executed on 2026-08-09 with 10 fixtures × 3 fresh browser contexts:

| Metric | Result | Internal gate |
|---|---:|---:|
| Task completion | 0.20 | descriptive only |
| Bug detection Recall | 1.00 | ≥ 0.80 |
| Precision | 1.00 | ≥ 0.80 |
| False-positive rate | 0.00 | ≤ 0.15 |
| Category accuracy | 1.00 | descriptive |
| Severity accuracy | 1.00 | descriptive |
| Product/Evaluator source accuracy | 1.00 | ≥ 0.85 |
| Inconclusive rate | 0.20 | descriptive |
| Run-to-run consistency | 1.00 | descriptive |

The 0.20 task-completion rate is expected: two clean fixtures complete, six deliberate product failures do not, and two evaluator/safety fixtures close as inconclusive. The 0.20 inconclusive rate is therefore also expected. The internal gate passed with no mismatches.

## Commands

```bash
npm run check
npm test
npm run test:benchmark
npm run test:real-benchmark
npm run test:ai-agent
npm run test:semantic-verifier
npm run test:browser
npm run test:runner
npm run build
npm run test:dashboard
npm run audit:package
npm run test:public-example
npm run test:consumer
```

## Known limits

- Perfect controlled-fixture scores must not be generalized to real model or external-product accuracy.
- A real-model benchmark requires explicit user credentials and must be reported separately from Mock Actor results.
- Ground Truth and predictions still require independent human review before any public reliability claim.
- GitHub-hosted CI is not verified until this branch is pushed and its workflow completes.
- Independent Critic/Evaluator review was unavailable in this execution environment.
