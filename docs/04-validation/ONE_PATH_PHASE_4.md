# One Evaluation Path Reset — Phase 4 Validation

- Branch: `refactor/one-evaluation-path`
- Phase 3 commit: `a5ab82a`
- Contract version: `0.6.0`
- Package version: `0.6.0-alpha.0`
- Scope: Phase 4 only. Immutable issue snapshots and all Phase 5+ behavior remain intentionally deferred.

## Runtime change

```text
AI Test Agent
→ Evidence Packet
→ Hybrid Judge
→ Evaluator Failure Classifier
   ├─ no failure: Finding Triage continues unchanged
   └─ evaluator failure: Inconclusive/Evaluator + EvaluatorBadcase
→ Finding Triage
```

The classifier reads only the current `AiTestAgentRun`, `EvidencePacket`, and `EvalCaseResult`. It does not infer a product defect from missing or ambiguous evidence.

## Taxonomy

| Category | Observable trigger |
|---|---|
| `no_next_action` | The evaluator explicitly reports that it cannot find a safe relevant next action |
| `unsupported_control` | The selected control is outside safe/supported execution |
| `model_output_invalid` | Provider output fails structured-output validation |
| `insufficient_context` | An abandoned page has no grounded controls or fields |
| `ambiguous_page_state` | The run and semantic result are both inconclusive and the page cannot be interpreted reliably |
| `wait_policy_exhausted` | A bounded wait expires without completion, explicit failure, or semantic failure evidence |
| `evidence_missing` | Evidence Completeness Gate fails |
| `navigation_mismatch` | Current-run evidence explicitly records a route/navigation mismatch |
| `tool_execution_error` | An action or evaluator tool fails |
| `unknown` | The run is evaluator-inconclusive but current evidence cannot safely refine the category |

An existing Semantic Fail remains a Candidate Finding when it does not satisfy Product Failure gates. Wait timeout alone does not overwrite that candidate lineage.

## User-facing result

The primary result is now:

> EvalPilot 暂时无法确定下一步操作。当前没有足够证据判断这是产品问题。

Expandable reasons list that the page may still be processing, the next entry may be unclear, or the evaluator may not yet understand the page. Technical classification remains available as structured detail.

## Storage and isolation

- Evaluator records are written atomically to `evaluator-badcases/v1/<id>.json` after Zod validation.
- `observedState`, `attemptedActions`, and `evidenceRefs` come from the current run only.
- The initial record is unresolved and has no regression fixture.
- Product Badcase creation remains gated by a confirmed Product Finding.
- No Evaluator Badcase enters Product Regression or Verified Coverage.
- Existing historical runs remain read-only and are not backfilled from legacy text.

## Files changed

- Contracts: `CONTRACT.md`, `types.ts`, `src/evaluator-errors/types.ts`, `src/evaluator-errors/schemas.ts`
- Runtime: `src/evaluator-errors/classifier.ts`, `src/evaluator-errors/store.ts`, `src/evaluation/adaptive-evaluation-service.ts`, `src/findings/finding-triage.ts`
- Compatibility copy: `src/ux-evaluation/exploratory-runner.ts`
- Tests: `tests/evaluator-failure-taxonomy.test.ts`
- Documentation: `ARCHITECTURE.md`, `CHANGELOG.md`, this validation record

## Acceptance evidence

- `npm run check`: passed.
- `npm test`: 39 files passed, 5 skipped; 179 tests passed, 27 skipped.
- `tests/evaluator-failure-taxonomy.test.ts`: 3 tests passed, covering all ten categories, novice copy, schema storage, and Product Badcase isolation.
- Real Chromium AI Agent/Evidence/Hybrid Judge suite: 3 files, 26 tests passed.
- `npm run build`: passed.
- `npm run audit:package`: passed; 168 files, 260,840 packed bytes, zero sensitive matches.

The first sandboxed Chromium attempt failed before test logic because macOS denied Chromium Mach port registration. The same command was rerun outside the filesystem sandbox and passed; this is an environment restriction, not a product-test failure.

## Known boundaries

- Classification is deterministic and conservative. Unrecognized evaluator failures use `unknown` instead of inventing a root cause.
- Phase 4 creates evaluator-learning records but does not yet add rerun/resolution UI or generate evaluator regression fixtures.
- No live external model or user credential is used by automated tests.
- Independent Critic/Evaluator threads are unavailable in this task. Builder validation is recorded explicitly and must not be represented as independent review.
