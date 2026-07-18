# Security and privacy

## Supported release

Security fixes target the newest Public Alpha. This local-first alpha is formally verified on macOS only.

## Report a vulnerability

Please use GitHub's private vulnerability reporting for `chusday97/evalpilot-local`. Do not include secrets, private source code, unredacted screenshots, Trace archives, or personal data in a public issue.

## Local safety boundaries

- EvalPilot listens on `127.0.0.1` and rejects non-loopback Host headers.
- Evaluation data defaults to `~/.evalpilot-local` and is never included in the npm package.
- `.env` files, credentials, tokens, Agent conversations, and Claude session JSONL are not read.
- Browser exploration avoids delete, payment, send, publish, and other irreversible actions.
- Codex direct repair requires explicit authorization, a Git baseline, an isolated worktree, `workspace-write`, allowed-path checks, project tests, and same-case retesting.
- Claude Code and Antigravity are task-package handoffs in this release and are never silently executed through Codex.
- Applying a repair requires the exact verified `agentRunId` and a clean target worktree.

Evaluation artifacts can contain page text and screenshots. Review and redact them before sharing.
