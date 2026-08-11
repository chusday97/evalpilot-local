# One Evaluation Path Phase 5 Validation

## Scope

Phase 5 removes ambiguous issue lookup from Fix Task creation. It does not implement Phase 6 regression promotion or expand Agent execution.

## Contract

- Evaluation issue request: `projectId + evaluationId + issueId + confirmed`.
- Adaptive request: `projectId + findingId + confirmed`; only `confirmed_product_failure` is accepted.
- Product Badcase request: `projectId + badcaseId + confirmed`.
- Immutable artifact: `fix-tasks/<fixTaskId>/source-snapshot.json`.
- Canonical sources: evaluation issue snapshot, flat Finding file, or Badcase file. The global latest UX report is never a Fix Task source.

## Regression proof

The automated regression creates Evaluation A and Evaluation B with the same `issueId`, changes the global report to B, creates a Fix Task while A is selected, then changes both A and the global report again. The saved task and task-package handoff continue to contain A's original goal and failure.

The Adaptive regression rejects an unconfirmed Finding, accepts the same Finding after explicit product-failure confirmation, mutates the canonical Finding afterward, and verifies that the saved source snapshot remains unchanged.

## Commands

```bash
npm run check
npm test -- --run tests/project-workspace.test.ts tests/foundation-persistence.test.ts tests/finding-triage.test.ts
npm test
npm run build
```

## Boundaries

- Old Fix Tasks without `source-snapshot.json` remain visible but cannot start a new Agent run; the user must recreate them from the original evaluation.
- Adaptive same-case automatic retesting is not added in this phase. Adaptive task packages preserve the exact case identity and require human review until that runtime is implemented.
- No real third-party model or independent Critic/Evaluator is used by these deterministic tests.
