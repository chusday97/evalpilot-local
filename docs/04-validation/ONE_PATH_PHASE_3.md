# One Evaluation Path Reset — Phase 3 Validation

- Branch: `refactor/one-evaluation-path`
- Baseline: `48b96eaebdebabd0686fc72753c1596104d08337`
- Phase 2 commit: `4ff7841`
- Contract version: `0.6.0`
- Package version: `0.6.0-alpha.0`
- Scope: Phase 3 only. Evaluator Failure taxonomy and all Phase 4+ behavior remain intentionally deferred.

## Runtime change

Before:

```text
Action → one bounded wait → Task State → Verification
```

After:

```text
Action
→ classify operation
→ select Wait Policy
→ lightweight Task State polls
→ extend only when new progress is observed
→ stop at completion / explicit failure / safety block / bounded stall
→ Verification
→ decide Persona failed-attempt cost
```

Polling observations stay inside the same user action. They do not create extra Decisions, Interaction Actions, screenshots, or Persona attempts.

## Policies

| Operation | Soft timeout | Hard timeout |
|---|---:|---:|
| Navigation | 3s | 8s |
| Form submit | 5s | 15s |
| AI generation | 10s | 60s |
| File processing | 15s | 90s |
| Unknown async | 8s | 30s |

Production polling uses a 1-second interval after the initial observation. Test fixtures may explicitly use shorter equivalent policies. Progress extensions never exceed the selected hard timeout or maximum extension count.

## Persona cost

`failedAttempts` increases only when:

- final Task State is `failed`; or
- final Task State is `stalled` and Step Verification is `not_confirmed`.

It does not increase for `pending`, `progressing`, a completed action, or a stalled action whose evidence remains inconclusive. Deterministic and Semantic Reflectors also explicitly refuse abandonment while a state is pending or progressing.

## Evidence and compatibility

- `TaskWaitEvidence` records operation type, selected policy, lightweight observations, extension count, final reason, and `consumedPersonaAttempt`.
- `task-state-observations.jsonl` stores poll order and operation type without creating full action evidence for each poll.
- `StepEvidence.taskState` remains the final state for convenient readers.
- Pre-Phase-3 current packets read `taskWait=null`; legacy packets remain incomplete compatibility views. Neither path invents a wait policy or Persona cost.
- Tool Schema version is `1.3.0`.

## Files changed

- Contracts: `CONTRACT.md`, `types.ts`, `src/test-agent/types.ts`, `src/test-agent/schemas.ts`
- Runtime: `src/test-agent/operation-classifier.ts`, `src/test-agent/progress-aware-wait.ts`, `src/test-agent/agent-runner.ts`, `src/test-agent/reflector.ts`, `src/test-agent/semantic-reflector.ts`, `src/test-agent/evidence-packet.ts`
- Tests: `tests/progress-aware-wait.test.ts`, `tests/ai-test-agent.test.ts`, `tests/semantic-verifier.test.ts`, `tests/evidence-gate.test.ts`
- Documentation: `ARCHITECTURE.md`, `CHANGELOG.md`, this validation record

## Acceptance evidence

- `npm run check`: passed.
- `npm test`: 38 files passed, 5 skipped; 176 tests passed, 27 skipped.
- Real Chromium Phase 3/Agent/Evidence/Semantic suite: 4 files, 32 tests passed.
- `npm run build`: passed.
- `npm run audit:package`: passed; 164 files, about 258KB packed, zero sensitive matches. (gzip byte size may vary slightly between identical local packs.)

The Chromium suite verifies progress extension and eventual completion, soft-timeout stall without ongoing progress, delayed loading, streaming output, low-confidence inconclusive behavior, explicit product failure, evidence compatibility, and a low-patience Persona completing without charged attempts.

## Known boundaries

- Operation classification is deterministic and evidence-bounded; ambiguous clicks use `unknown_async`, which is intentionally conservative and may wait longer.
- A stalled result with inconclusive verification does not consume Persona patience. Phase 4 will classify exhausted/ambiguous evaluator behavior explicitly instead of turning it into a product failure.
- No new Dashboard surface is introduced in this phase. Result-action UX belongs to later confirmed phases.
- No live external model or user credential is used by automated tests.
- Independent Critic/Evaluator threads are unavailable in this task. Builder validation is recorded explicitly and must not be represented as independent review.
