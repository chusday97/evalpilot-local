# Evaluator Accuracy Sprint — Phase 3 Validation

## Scope

Phase 3 implements Candidate Finding triage and the Product Failure Gate only. AI Agent CI, semantic step verification, Product Task Understanding, and the real evaluator benchmark are not included.

## Contract and runtime behavior

- Findings created after One Evaluation Path Phase 5 are stored as schema-validated atomic JSON under `findings/<findingId>.json`; existing `findings/v1/` records remain readable without being rewritten.
- A single Semantic Fail defaults to `verdict=inconclusive` and `failureSource=unknown`.
- Complete deterministic hard failures may become confirmed Product Failures.
- Strong semantic confirmation requires confidence of at least 0.80, at least two valid references, at least two independent evidence types, no evaluator failure, and a Case that does not require human review.
- A stable Case may be confirmed after the same normalized observed failure appears in two independent complete runs.
- Cases marked `needsHumanReview` remain review-required regardless of model confidence.
- Provider and evaluator failures are stored separately and never become candidate product findings or Badcases.
- Badcase creation re-reads a persisted `confirmed_product_failure` Finding and verifies project, case, and run lineage.
- Confirm, evaluator-failure, and dismiss APIs all require `{ "confirmed": true }`.

## Required triage cases

| Case | Verified outcome |
|---|---|
| Semantic Fail, confidence 0.60 | Candidate Finding only; no Badcase |
| Semantic Fail, confidence 0.95, screenshot-only evidence | Candidate Finding only; no Badcase |
| Deterministic hard failure with complete evidence | Confirmed Product Failure and Badcase |
| `needsHumanReview=true` | Needs Human Review; no Badcase |
| Same stable observed failure in two independent runs | Second run confirms Product Failure and creates Badcase |
| Provider/evaluator error | Evaluator Failure; no candidate product finding or Badcase |
| Explicit human confirmation | Confirmed Product Failure and Badcase |
| Explicit dismiss | Dismissed Finding; no Badcase |

## Commands and results

- `npm run check`: passed.
- `npm test`: 32 files passed, 3 skipped; 140 tests passed, 17 skipped.
- `npm run build`: passed; Dashboard production bundle generated.
- Finding/Badcase/Judge/API focused suite: 22 tests passed.
- Real Chromium Agent/Evidence suite: 4 files, 27 tests passed.
- Dashboard/Project desktop and 390px suite: 2 files, 6 tests passed, including candidate triage confirmation and feedback.
- `npm run audit:package`: 141 files, 226,612 packed bytes, 0 sensitive matches.
- `git diff --check`: passed before commit.

## Boundaries

- Repeated failure matching is deliberately strict: same stable Case, normalized category, and normalized observed summary. Broader semantic clustering is deferred.
- Human confirmation records the decision and creates a Badcase; it does not claim the root-cause hypothesis is proven.
- Phase 4 AI Agent CI has not started.
- Independent Critic/Evaluator review and remote GitHub CI were not available in this environment.
