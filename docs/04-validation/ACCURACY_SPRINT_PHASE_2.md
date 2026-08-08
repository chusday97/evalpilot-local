# Evaluator Accuracy Sprint — Phase 2 Validation

## Scope

Phase 2 implements the Evidence Completeness Gate only. Candidate Finding triage, CI expansion, semantic verification, Product Understanding, and real evaluator benchmarking are not included.

## Contract and runtime behavior

- Every recorded Agent action owns a distinct `step-NNN-before.png` and `step-NNN-after.png`.
- `StepEvidence` connects the before/after Observation IDs, Decision ID, Verification ID, screenshot paths, and action status.
- `finish` and `abandon` decisions use the same capture path, so their after screenshot is the final action evidence.
- Adaptive runs create a local Playwright `trace.zip` with `sources: false`.
- `EvidenceCompleteness` is recomputed from packet references; a stored `complete: true` value cannot bypass the Judge gate.
- Missing initial/final observations, before/after screenshots, step verifications, or Trace produces `verdict=inconclusive` and `failureSource=evaluator`.
- Incomplete evidence clears semantic confirmed facts and root-cause hypotheses from the effective result.
- Legacy Evidence Packets are converted in memory to an explicitly incomplete compatibility view and are never rewritten.

## Required failure cases

| Case | Verified outcome |
|---|---|
| before screenshot missing | Evaluator Inconclusive |
| after screenshot missing | Evaluator Inconclusive |
| fewer verifications than executed actions | Evaluator Inconclusive |
| complete packet | Judge may continue to PASS/FAIL logic |
| Trace write failure | run remains readable, Trace is reported missing, result is Evaluator Inconclusive, Badcase is null |
| finish action | final `step-003-after.png` is linked by `StepEvidence` |
| legacy packet | readable, incomplete, no promoted verdict |

## Commands and results

- `npm run check`: passed.
- `npm test`: 31 files passed, 3 skipped; 130 tests passed, 17 skipped.
- `npm run build`: passed; Dashboard production bundle generated.
- `EVALPILOT_BROWSER_TEST=1 npx vitest run tests/ai-test-agent.test.ts tests/evidence-gate.test.ts`: 2 files, 18 tests passed.
- `npm run test:dashboard`: 2 files, 6 tests passed, including desktop and 390px checks.
- `npm run audit:package`: 137 files, 222,582 packed bytes, 0 sensitive matches.
- `git diff --check`: passed before commit.

## Boundaries

- There is no enabled Trace exception in Phase 2; a missing Trace is intentionally inconclusive.
- Existing non-adaptive runners are unchanged.
- Phase 3 Candidate Finding / Product Failure Gate has not started.
- Independent Critic/Evaluator review and remote GitHub CI were not run in this environment.
