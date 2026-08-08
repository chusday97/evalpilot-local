# Evaluator Accuracy Sprint — Phase 4 Validation

## Scope

Phase 4 adds a dedicated AI Agent CI gate. It does not start the Phase 5 semantic verifier or change the default Legacy Evaluation flow.

## CI contract

`npm run test:ai-agent` runs with `EVALPILOT_BROWSER_TEST=1` and includes:

- `tests/ai-test-agent.test.ts`
- `tests/evidence-gate.test.ts`
- `tests/hybrid-judge.test.ts`

The GitHub `chromium-smoke` job installs Chromium, builds the package, and then runs this gate. Tests use `MockAiProvider`; no OpenAI key is configured or required. Chromium, DOM grounding, action execution, before/after screenshots, local Playwright Trace, Hybrid Judge, Finding triage, Badcase creation, Regression promotion, and Challenge generation use production code paths.

## Acceptance mapping

| Required behavior | Automated evidence |
|---|---|
| Form completion passes | AI Agent fills and submits a real Chromium page, then Hybrid Judge returns PASS |
| Dead click becomes confirmed failure | Repeated Save click has no change; evidence-backed hard failure creates a Product Badcase |
| Destructive action is blocked | Delete-account action returns `blocked_by_safety` |
| Malformed model output is evaluator failure | Exhausted invalid structured output returns Evaluator Inconclusive |
| Candidate Challenge is not verified | Candidate-only coverage cells remain `verified=false` |
| Missing evidence creates no Badcase | Evidence Gate test removes required Trace and asserts no Product Badcase |
| Fixed Badcase becomes Regression | The same browser case passes after a fixture fix and is promoted to a stable Regression case |
| PASS creates Challenge candidates | Passing-case analysis persists three candidates and links them to coverage gaps |

## Local verification

Run from the repository root:

```bash
npm run check
npm run test:ai-agent
npm test
npm run build
```

Success means all commands exit with code 0 and `test:ai-agent` reports no skipped browser tests. A green local run validates the workflow code, but the hosted GitHub Actions result must still be checked after the branch is pushed.

## Known limits

- This gate isolates workflow correctness with deterministic Mock responses; it does not measure real-model accuracy.
- GitHub-hosted Actions is not proven by a local run alone.
- Independent Critic/Evaluator review was not available in this execution environment and must not be inferred from Builder tests.
