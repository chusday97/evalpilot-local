# Changelog

## 0.5.0-alpha.1

- Added portable npm CLI packaging, `doctor`, explicit Chromium setup, and user-level data storage.
- Added the four-step novice Dashboard, semantic evaluation history, structured issue evidence, and API-not-applicable results.
- Added truthful Agent capabilities: Public Alpha uses task-package handoff for Codex, Claude Code, Antigravity, and other Agents; automatic repair remains disabled until a real before/after gate passes.
- Added explicit, non-overwriting legacy data migration with `evalpilot migrate --confirmed`.
- Added privacy/package gates, independent tarball installation checks, GitHub CI, and public project documentation.
- Fixed the public no-API example identity check and added a tarball-installed add → core evaluation → report release gate; CI now executes the real port-recovery test.

This is a Public Alpha. macOS is the only formally verified platform.
