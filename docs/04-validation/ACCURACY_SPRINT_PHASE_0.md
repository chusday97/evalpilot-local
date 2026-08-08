# Evaluator Accuracy Sprint — Phase 0 Baseline

- Baseline commit: `3b8df0383ace1c1788792969d84a4dc00a3ac60c`
- Branch: `fix/coverage-truth-model`
- Date: 2026-08-08 (Asia/Shanghai)
- OS: macOS 15.3.1 (Build 24D70, Apple Silicon)
- Node.js: 24.14.0
- npm: 11.9.0
- Playwright Chromium: 149.0.7827.55

## Commands

- `npm ci`: passed, 85 packages installed.
- `npm run check`: passed.
- `npm test`: 29 files passed, 3 skipped; 116 tests passed, 16 skipped.
- `npm run build`: passed.
- `npm run audit:package`: passed; 217,989 bytes, 137 files, 0 sensitive matches.
- `npm run test:browser`: 2 passed.
- `npm run test:runner`: 7 passed.
- `npm run test:dashboard`: 6 passed.

The first browser attempt inside the restricted sandbox failed with macOS MachPort and loopback `EPERM`. Running the same commands in the approved local environment passed, so this is recorded as an environment restriction rather than an existing repository failure.
