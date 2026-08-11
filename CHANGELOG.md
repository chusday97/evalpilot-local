# Changelog

## Unreleased

- Added a ten-category Evaluator Failure taxonomy with schema-validated, versioned `EvaluatorBadcase` storage that stays separate from Product Badcase and Regression lineage.
- Changed evaluator-inconclusive results to use novice-facing copy and expandable possible reasons while retaining technical classification in structured evidence.
- Preserved low-confidence product-failure observations as Candidate Findings; wait exhaustion becomes an evaluator failure only when the semantic result is also inconclusive.
- Replaced the AI Test Agent's single bounded wait with operation-aware soft/hard timeouts, lightweight progress polling, and bounded extensions for navigation, form submission, AI generation, file processing, and unknown async work.
- Separated waiting from Persona cost: pending/progressing polls create no extra user actions and consume no retry or patience budget; only explicit failure or an unconfirmed stalled result counts as a failed attempt.
- Added per-step `TaskWaitEvidence` with the selected operation type, policy, state timeline, extension count, final reason, and Persona-attempt decision while keeping pre-Phase-3 packets readable.
- Added a Task State Monitor between Agent actions and verification, with loading, progress, completion, failure, network, blocked, and stalled evidence persisted per step.
- Changed pending and progressing actions to remain verification-inconclusive instead of being reported as product failures; pre-monitor Evidence Packets stay readable with an explicit null task state.
- Changed the normal Dashboard evaluation path to use Product Model → Eval Set selection → AI Test Agent → Hybrid Judge → Finding Triage instead of the Legacy Explorer.
- Added a schema-validated Evaluation Orchestrator, Product Model-aware Quick/Core/Full selection, per-session Adaptive run/Finding/Badcase lineage, and immutable evaluation report snapshots.
- Added an explicit AI Provider setup gate and per-run remote-model consent; missing configuration no longer silently falls back to Legacy or produces a substitute result.
- Preserved old Evaluation Sessions through read-only `runtime=legacy` compatibility while new sessions persist `runtime=adaptive`, selected cases, coverage, authorization, and evidence lineage.
- Added a local source-evidence fingerprint so Product Model/Eval Set assets are reused while evidence is unchanged and rebuilt after scan evidence changes.
- Updated guided-flow routing to send completed Adaptive evaluations to real run/Finding evidence instead of the empty Legacy issue snapshot.
- Fixed multi-case Adaptive evaluations so final Coverage is recomputed from every selected result and Evidence Packet instead of retaining only the last case's run evidence.
- Serialized per-project Evaluation Session persistence so an immediate retry or concurrent progress update cannot collide on the atomic JSONL temporary file.
- Added a Phase 7 real-browser evaluator benchmark with 10 runnable local Web apps, isolated Ground Truth, three fresh-context repetitions per fixture, and persisted reviewable predictions.
- Added task completion, Recall, Precision, false-positive, category, severity, failure-source, inconclusive, and run-to-run consistency metrics with internal-only reliability gates.
- Added `test:real-benchmark` to Chromium CI while keeping the existing 40 precomputed fixtures explicitly scoped as a rule-level unit benchmark.
- Changed safety-blocked adaptive runs to Evaluator Inconclusive so destructive tasks cannot be mislabeled as product failures or create Badcases.
- Fixed Badcase classification so duplicate submissions and irrelevant AI output are distinguished from API failures.
- Added evidence-bounded Product Understanding for task-level capabilities, object lifecycles, cross-page journeys, task-specific business rules, and observable success signals.
- Added a schema-validated Oracle Builder that filters unsupported assertions, invented evidence, unrelated rules, and ungrounded expected outcomes before creating Baseline cases.
- Added explicit Dashboard consent for AI task understanding, deterministic fallback messaging, and form/CRUD/AI-generation comparison fixtures; inferred rules always require human review.
- Added per-action Semantic Step Verification, deterministic/semantic conflict handling, remote screenshot consent enforcement, and versioned verifier/reflector prompts.
- Replaced fixed AI Agent delays with bounded target-text, route/DOM, loading-completion, field-value, scroll, and network-idle signals.
- Added explicit Persona knowledge, patience, retry, privacy, and exit policies with read-only defaults for legacy cases; Reflector no longer derives patience from behavior text length.
- Added five real-Chromium Phase 5 acceptance paths for ordinary forms, delayed loading, streaming output, no-feedback abandonment, and wrong-path recovery.
- Changed the development version to `0.6.0-alpha.0` after the Phase 0–4 contracts, runtime, tests, and public documentation were aligned.
- Added `test:ai-agent`, a Mock-Provider CI gate that runs real Chromium, DOM grounding, before/after screenshots, local Trace, Hybrid Judge, Finding, Badcase, Regression, and Challenge flows without a real OpenAI key.
- Added browser acceptance cases for form PASS, dead click, blocked destructive action, malformed model output, Candidate Finding isolation, Candidate Challenge coverage isolation, missing-evidence Badcase prevention, and fixed-Badcase regression promotion.
- Documented the stable Legacy Evaluation and experimental Adaptive Evaluation paths, including remote-model consent, optional screenshot authorization, and local-only evidence boundaries.
- Added versioned Candidate Finding storage, explicit product/evaluator/dismiss triage actions, and a novice-facing Findings view that separates suspicious observations from confirmed product failures.
- Changed single Semantic Fail results to `inconclusive/unknown` unless they pass deterministic, multi-evidence, repeated-stable-run, or explicit human-confirmation gates.
- Restricted Badcase creation to persisted `confirmed_product_failure` Findings so evaluator errors, low-confidence judgments, and review-required cases cannot pollute regression assets.
- Added per-action before/after observations and screenshots, explicit `StepEvidence`, local Playwright Trace with source capture disabled, and a recomputed Evidence Completeness Gate.
- Changed incomplete adaptive evidence to Evaluator Inconclusive so missing screenshots, verifications, references, final state, or Trace cannot produce PASS or Product FAIL.
- Preserved legacy Evidence Packets through an in-memory compatibility view that marks them incomplete without rewriting historical files.
- Updated adaptive run details and exported reports to explain whether evidence is sufficient and list missing evidence in user-readable language.
- Changed adaptive coverage to report asset, execution, and verified ratios separately; only stable PASS results with valid evidence can increase Verified Coverage.
- Added capability-scoped coverage cells and explicit missing-asset, not-executed, not-verified, inconclusive, and failed gaps so one feature cannot borrow another feature's evidence.
- Preserved legacy coverage files as read-only asset history while preventing them from being promoted to verified coverage without run and evidence links.
- Updated the Dashboard and adaptive report to lead with Verified Coverage and label unrun candidates as “已定义，未运行”.
- Added the Phase 0 data foundation for Product Models, adaptive Eval Sets, Oracles, hybrid Judge results, Badcases, multidimensional coverage, and regression lineage.
- Added schema-validated atomic JSON stores with project/path isolation and compatibility tests that leave existing Public Alpha evaluation history untouched.
- Added an experimental grounded AI test agent, evidence-gated hybrid Judge, Product Model baseline generation, Badcase regression promotion, coverage analysis, and challenge-case candidates.
- Added safe free-exploration planning and explicit promotion of evidenced reusable findings into exploratory candidates.
- Added the six-goal adaptive Dashboard, Eval Set/Run/Badcase/Regression APIs, coverage gaps, rich evidence journeys, and backward-compatible legacy routes.
- Added a local 40-fixture self-benchmark command with recall, precision, false-positive, classification and evaluator-failure metrics.
- Added the complete experimental execution path from AI Test Agent through Hybrid Judge, Badcase or passing-case analysis, coverage persistence, and a 16-section evidence report.
- Added run selection for Quick/Core/Full, complete version metadata, optional AI-output Oracles, explicit remote-model consent, and provider readiness without exposing credentials.
- Changed passing-case evolution so generated Challenge cases persist as reviewable candidates and are linked from their originating coverage gaps; they are never auto-promoted to stable cases.
- Reduced the publish whitelist to runtime JavaScript so the expanded package remains 137 files, about 213KB, with zero sensitive matches.
- Fixed clean tarball browser installs by pinning Playwright to the browser revision installed by CI instead of allowing a newer runtime to drift beyond the lockfile.

## 0.5.0-alpha.1

- Added portable npm CLI packaging, `doctor`, explicit Chromium setup, and user-level data storage.
- Added the four-step novice Dashboard, semantic evaluation history, structured issue evidence, and API-not-applicable results.
- Added truthful Agent capabilities: Public Alpha uses task-package handoff for Codex, Claude Code, Antigravity, and other Agents; automatic repair remains disabled until a real before/after gate passes.
- Added explicit, non-overwriting legacy data migration with `evalpilot migrate --confirmed`.
- Added privacy/package gates, independent tarball installation checks, GitHub CI, and public project documentation.
- Fixed the public no-API example identity check and added a tarball-installed add → core evaluation → report release gate; CI now executes the real port-recovery test.
- Fixed the package privacy audit on CI by matching complete local home paths instead of common account-name words such as `runner`.
- Fixed core evaluations so up to three distinct capabilities receive real user-journey runs instead of repeating one capability with different personas.
- Added capability-level discovered, planned, browser-visited, executed, passed, and not-run evidence; incomplete or legacy evidence can no longer produce a “can continue” verdict.

This is a Public Alpha. macOS is the only formally verified platform.
