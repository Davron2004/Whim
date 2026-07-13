## Why

The Codex Class-2 approval bridge currently creates redeemable authority before the user approves it and reopens a mutable protected patch during application, so denial, interruption, and concurrent replacement can violate the claimed one-shot, exact-bytes security boundary. This control plane needs an explicit capability contract and behavioral regression suite before it can safely ratify future protected changes.

## What Changes

- Introduce a Git-private, permission-restricted approval state store with distinct immutable patch, pending, approved, consuming, consumed, and terminal records.
- Bind every request and single-use capability to the exact patch SHA-256, registered root session, transcript, repository/worktree identity, creation time, and a five-minute expiry.
- Stage and validate exact candidate bytes before the prompt, but make all pre-prompt state structurally non-redeemable; create redeemable authority only on the approved helper execution path.
- Atomically claim each capability before one application attempt, reject replay and concurrent redemption, and fail closed on malformed, symlinked, mis-owned, mis-permissioned, expired, mismatched, or tampered state.
- Add append-oriented Git-private auditing for authorization, denial-observable cleanup, consumption, application, rejection, replay, expiry, and unauthorized attempts without storing patches, transcripts, tokens, or environment dumps.
- Expand isolated behavioral tests across success, denial/interruption cleanup, immutable-copy TOCTOU, tampering, replay, concurrency, expiry, session rotation/mismatch, subagent denial, malformed state, target scope, and audit integrity.
- Preserve direct protected-edit denial, native Codex Allow/Deny prompting, Claude behavior, worktree compatibility, and all existing protected classifications.
- Document the threat model, lifecycle, operator review flow, cleanup/recovery procedure, audit inspection, and Codex denial-observability limitation.

## Capabilities

### New Capabilities

- `codex-protected-approval`: Exact-hash, root-session-bound, expiring, single-use human authorization for applying Class-2 protected patches through Codex.

### Modified Capabilities

None.

## Impact

The change affects the Codex root-session registration and protected-patch hooks, native exec-policy integration, provider adapter and security regression tests, mirror/gate enforcement, the canonical harness documentation, and the capability index. Authority-bearing state remains outside the working tree beneath the repository's Git common directory. No mini-app runtime, SDK, launcher, server, or `sdk-navigation` behavior changes.
