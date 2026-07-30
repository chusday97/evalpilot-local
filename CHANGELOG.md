# Changelog

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
