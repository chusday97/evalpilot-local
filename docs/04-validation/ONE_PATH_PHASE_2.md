# One Evaluation Path Reset — Phase 2 Validation

- Branch: `refactor/one-evaluation-path`
- Baseline: `48b96eaebdebabd0686fc72753c1596104d08337`
- Phase 1 commit: `f3e9b0e`
- Contract version: `0.6.0`
- Package version: `0.6.0-alpha.0`
- Scope: Phase 2 only. Progress-aware waiting, Persona attempt cost, dynamic timeout and all Phase 3+ behavior remain intentionally deferred.

## Runtime change

Before:

```text
Action → bounded wait → Verification
```

After:

```text
Action
→ capture before/after task signals
→ Task State Monitor
→ ready | interacting | pending | progressing | completed | failed | blocked | stalled
→ Verification gate
```

`pending` and `progressing` mean that the product is still working or has observable progress. They force the current step result to `inconclusive`; they cannot become a Verification Failure.

## Signals and evidence

- Loading: visible `aria-busy`, `progressbar`, spinner/loading markers, and loading/generating/processing/uploading/thinking/searching text.
- Progress: visible-text growth, appended DOM nodes, changed status text, changed progress values, and continuing network responses.
- Completion: newly visible expected-result tokens, known completion markers, loading disappearance with an updated result, a re-enabled action button, or an explicit Agent finish action.
- Failure: explicit visible error state, core document/XHR/fetch 4xx/5xx, an uncaught page error, or an action execution failure.
- Every `StepEvidence` stores its `TaskStateObservation`; a matching `task-state-observations.jsonl` is written beside the Evidence Packet.
- Existing current-format packets without the field read it as `null`. Legacy packets remain incomplete compatibility views. Neither path invents a historical runtime state or rewrites source files.

## Files changed

- Contracts: `CONTRACT.md`, `types.ts`, `src/test-agent/types.ts`, `src/test-agent/schemas.ts`
- Runtime: `src/test-agent/task-state-signals.ts`, `src/test-agent/task-state-monitor.ts`, `src/test-agent/agent-runner.ts`, `src/test-agent/evidence-packet.ts`
- Tests: `tests/task-state-monitor.test.ts`, `tests/ai-test-agent.test.ts`, and compatibility fixture updates
- Documentation: `ARCHITECTURE.md`, `CHANGELOG.md`, this validation record

## Acceptance evidence

- `npm run check`: passed.
- `npm test`: 37 files passed, 5 skipped; 170 tests passed, 25 skipped.
- `npm run build`: passed.
- `npm run audit:package`: passed; 162 files, 255,021 packed bytes in the final committed-tree run, zero sensitive matches.
- Real Chromium Task State/Evidence suite: 2 files, 21 tests passed.
- Focused Task State unit suite: 8 tests passed.
- The first restricted-sandbox Chromium launch failed before assertions because macOS denied the Chromium Mach port. The identical suite passed after using the approved local browser execution permission.

## Known boundaries

- Phase 2 captures state at the current bounded-wait observation point. It does not yet extend the wait while progress continues.
- The existing Reflector may still count an inconclusive step toward its attempt budget. Phase 3 owns progress-aware waiting and the rule that pending/progressing consumes no Persona failed attempt.
- No new Dashboard surface is introduced in this phase; stored Task State evidence is the runtime foundation for later progress UX.
- No live external model or user credential is used by automated tests.
- Independent Critic/Evaluator threads are unavailable in this task. Builder validation is recorded explicitly and must not be represented as independent review.
