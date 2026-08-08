# One Evaluation Path Reset — Phase 0 Baseline

- Baseline commit: `48b96eaebdebabd0686fc72753c1596104d08337`
- Branch: `refactor/one-evaluation-path`
- Date: 2026-08-09 (Asia/Shanghai)
- OS: macOS 15.3.1 (Build 24D70, Apple Silicon)
- Node.js: 24.14.0
- npm: 11.9.0
- Contract version: `0.6.0`
- Package version: `0.6.0-alpha.0`

## Baseline Commands

- `npm ci`: passed; 85 packages installed.
- `npm run check`: passed.
- `npm test`: 35 files passed, 5 skipped; 155 tests passed, 24 skipped.
- `npm run build`: passed.
- `npm run test:ai-agent`: 3 files and 23 tests passed.
- `npm run test:semantic-verifier`: 2 files and 12 tests passed.
- `npm run test:real-benchmark`: passed; the benchmark fixture runs 10 browser apps three times each.

The first Chromium attempt inside the restricted sandbox failed before test assertions because macOS denied the Chromium Mach port. Re-running the same commands in the approved local environment passed, so this is an environment restriction rather than a repository baseline failure.

## Current Dashboard Routes

- `/`: new-user guidance and latest evaluation summary.
- `/projects`: add, start, and switch projects.
- `/evaluate`: normal guided evaluation entry.
- `/issues`: legacy evaluation report and issue history.
- `/eval-set`: adaptive Eval Set assets.
- `/runs`: adaptive run results and evidence.
- `/findings`: adaptive Candidate Findings and Badcases.
- `/fixes`: fix task packages and verification attempts.
- `/regression`: promoted regression cases.

## Runtime Audit

Current normal path:

```text
Home
→ /evaluate
→ POST /api/evaluations
→ startEvaluation()
→ executeEvaluation()
→ runExploratoryScenario()
```

Current adaptive path:

```text
/eval-set
→ /eval-cases/:id/run
→ runAdaptiveCase()
→ AI Test Agent
→ Hybrid Judge
→ Finding Triage
→ adaptive report
```

Phase 1 must route normal `/evaluate` sessions through the second runtime while preserving legacy records and keeping the Legacy Explorer available only for internal compatibility.
