# Changelog

## Unreleased

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
