# One Evaluation Path Reset — Phase 1 Validation

- Branch: `refactor/one-evaluation-path`
- Baseline: `48b96eaebdebabd0686fc72753c1596104d08337`
- Phase 0 commit: `85fb06a`
- Contract version: `0.6.0`
- Package version: `0.6.0-alpha.0`
- Scope: Phase 1 only. Task State Monitor and all Phase 2+ behavior are not implemented in this commit.

## User-visible change

The normal Dashboard evaluation button now requires a configured OpenAI provider and explicit per-run consent. After consent, it runs Adaptive Eval Set cases and sends the user to the real run/evidence view. It never substitutes the Legacy Explorer when provider setup or execution fails.

The setup state explains the required environment variable without exposing a key. Screenshots and local Playwright Trace remain excluded from remote-model input by default.

## Exact runtime migration

Before:

```text
Dashboard /evaluate
→ POST /api/evaluations
→ startEvaluation()
→ executeEvaluation()
→ runExploratoryScenario()
→ Legacy UX Issue report
```

After:

```text
Dashboard /evaluate
→ POST /api/evaluations (explicit remote-model consent)
→ startEvaluation()
→ executeEvaluation()
→ scan / Background / Blueprint
→ Evaluation Orchestrator
→ load or rebuild Product Model + Eval Set from a local evidence fingerprint
→ select Quick / Core / Full cases
→ AI Test Agent
→ Evidence Gate + Hybrid Judge
→ Finding Triage
→ evaluation report + Coverage Matrix
→ /runs?runId=<real-run-id>
```

The normal evaluation manager no longer imports or calls `runExploratoryScenario()`.

## Contracts and storage

- `EvaluationSession.runtime` distinguishes new `adaptive` sessions from compatible `legacy` history.
- New sessions persist selected Case IDs, real run IDs, Finding IDs, Badcase IDs, Coverage Matrix, remote-model authorization, and screenshot authorization.
- `EvaluationOrchestratorInput` requires `allowRemoteModel: true`; `legacyFallback` can only be absent or `false`.
- `EvaluationFoundationState` records a SHA-256 fingerprint of Background, Blueprint, routes, page evidence, and document evidence. Unchanged sources reuse the current Product Model/Eval Set; changed sources rebuild them.
- Each evaluation stores `evaluations/<evaluation-id>/report.json`. The existing empty `issues.jsonl` snapshot remains only as a legacy API compatibility boundary.
- After all selected cases finish, the Orchestrator recomputes and atomically saves Coverage from the complete result/evidence set; an individual case cannot replace evidence from earlier cases in the same evaluation.
- Evaluation Session writes are serialized per project and snapshot their queued state, preventing immediate retries or concurrent progress updates from colliding on the JSONL file.

## Selection behavior

- Quick: one critical Baseline plus relevant Regression cases.
- Core: critical/high Baselines, all relevant Regressions, and up to three selected Challenges.
- Full: all non-retired Baseline, Regression, Challenge, and Exploratory cases for the selected capabilities.
- Every depth filters by capability; a case from an unselected capability cannot enter the run.

## Legacy compatibility

- Existing sessions are read as `runtime=legacy` in memory and are not rewritten.
- Legacy issue/report files remain readable through their existing APIs.
- Failed Legacy sessions are read-only. Retry returns `LEGACY_EVALUATION_READ_ONLY` because a historical session cannot supply current remote-model consent.
- The old Legacy modules remain available for CLI compatibility and internal diagnostics, but the ordinary Dashboard path cannot select them.

## Files changed

Contracts and architecture:

- `CONTRACT.md`, `types.ts`, `src/schemas/workspace.ts`, `ARCHITECTURE.md`, `CHANGELOG.md`

Adaptive orchestration:

- `src/evaluation/evaluation-orchestrator.ts`
- `src/evaluation/evaluation-selector.ts`
- `src/evaluation/evaluation-foundation.ts`
- `src/evaluation/schemas.ts`
- `src/evaluation/adaptive-evaluation-service.ts`
- `src/eval-set/eval-set-runner.ts`

Dashboard runtime and guidance:

- `src/dashboard/evaluation-manager.ts`
- `src/dashboard/guidance-service.ts`
- `src/dashboard/adaptive-dashboard-data.ts`
- `src/dashboard/server.ts`
- `dashboard/src/GuidedPages.tsx`
- `dashboard/src/styles.css`

Tests:

- `tests/one-evaluation-path.test.ts`
- `tests/project-workspace.test.ts`
- `tests/ai-test-agent.test.ts`
- `tests/dashboard-ui.test.ts`

## Tests and evidence

- `npm run check`: passed.
- `npm test`: 36 files passed, 5 skipped; 161 tests passed, 24 skipped.
- `npm run build`: passed.
- `npm run test:ai-agent`: 3 files and 23 real-Chromium tests passed.
- `npm run test:dashboard`: 2 files and 8 tests passed, including desktop and 390px browser acceptance.
- `npm run test:semantic-verifier`: 2 files and 12 tests passed.
- `npm run test:real-benchmark`: 1 file and 1 benchmark test passed in 195.77 seconds; the fixture covers 10 runnable browser apps with three repetitions each.
- `npm run audit:package`: passed; 160 files, 251,785 packed bytes, zero sensitive matches.

The browser acceptance suite verifies that Adaptive runs produce `evidence-packet.json`, `agent-run.json`, and `trace.zip`. A source guard also fails if the normal evaluation manager reintroduces `runExploratoryScenario`.

## Known boundaries and next phase

- This phase does not add `pending`, `progressing`, or `stalled` task states. Long-running behavior remains the next planned risk.
- The full Result → Next Action Engine is intentionally deferred to Phase 6 under the confirmed Phase 0–10 numbering.
- No live external OpenAI key was used in automated tests; real-model behavior still requires user-owned credentials and explicit consent.
- Independent Critic/Evaluator threads were unavailable for this delivery. Builder validation is recorded above and must not be represented as independent review.

Phase 2 is not started. Its only scope is Task State Monitor behavior from the attached execution specification.
