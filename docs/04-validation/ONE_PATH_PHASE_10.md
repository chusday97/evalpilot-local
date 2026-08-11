# One Evaluation Path Reset — Phase 10 Validation

## Scope

Phase 10 quarantines the legacy evaluation runtime without deleting historical user data.

- Normal Dashboard navigation is `项目 → 评测 → 运行 → 发现 → 修复 → 回归`.
- `/evaluate` continues to use `runEvaluationOrchestrator` only.
- The public CLI no longer exposes `run --exploratory`.
- Legacy Dashboard run creation, controls, direct lookup, and event subscription return `410 LEGACY_RUNTIME_QUARANTINED` with a novice-readable recovery action.
- Evaluation records without a runtime remain readable as legacy records; retry is rejected without rewriting the source file.
- The retained exploratory runner is marked `@deprecated legacy evaluation runtime` and remains available only to migration tests, compatibility repair retests, and internal diagnostics for one release cycle.

## Verification

Executed on 2026-08-11 (macOS, Node runtime required by the repository):

- `npm run check` — passed.
- `npx vitest run tests/legacy-quarantine.test.ts tests/one-evaluation-path.test.ts tests/project-workspace.test.ts tests/dashboard-api.test.ts` — 26 passed, 1 skipped.
- `npm test` — 209 passed, 34 skipped across 48 files.
- `npm run build` — passed; production Dashboard bundle generated.
- `npm run test:dashboard` — passed with loopback permission; desktop and 390px browser suite completed with exit code 0.
- `npm run audit:package` — 173 files, 272250 packed bytes, 0 sensitive matches.
- `git diff --check` — passed.

## Compatibility and review boundary

- No legacy session, report, screenshot, Trace, or local project record was deleted or rewritten.
- The legacy runner remains in source for one release cycle; deletion is explicitly outside Phase 10.
- Real Provider evaluation, external user comprehension testing, and an independent Critic/Evaluator review were not run. Current collaboration constraints did not permit an independent review thread, so Builder verification must not be represented as independent acceptance.
- The branch has not been pushed or merged into public `main` as part of Phase 10.
