## 1. HUMAN-BOOTSTRAP protected approval core and proof

- [ ] 1.1 Add a small shared Codex approval-state library that resolves and validates Git-common private directories, enforces owner/type/mode/schema checks, writes complete state atomically, records append-oriented audit events, and performs fixed 300-second expiry/orphan cleanup.
- [ ] 1.2 Harden root-session registration with a random per-registration nonce, repository/worktree identity, atomic replacement, prior-session invalidation, and safe audit records while continuing to reject agent SessionStart events.
- [ ] 1.3 Refactor PreToolUse authorization to parse only the exact helper command, deny subagents before prompting, capture candidate bytes once, verify the supplied hash, validate applicability and complete protected target scope, publish the immutable object, and create only inert pending state.
- [ ] 1.4 Refactor the approved helper to revalidate current root/session/repository/HEAD binding, object integrity and scope, atomically rename pending state to a single consuming owner, apply only already-opened protected-object descriptors, and publish applied/failed terminal state without reusable grants.
- [ ] 1.5 Expand the isolated bridge suite with successful real Class-2 application, direct-edit denial, exact-byte/audit assertions, denial/interruption cleanup, and original candidate mutation/deletion/replacement/symlink-swap cases.
- [ ] 1.6 Add behavioral cases for initial/protected-copy hash mismatch and tampering, replay, simultaneous redemption, controlled expiry, session/worktree/restart mismatch, root-versus-subagent request and consumption, malformed/symlinked/insecure state, wrong/mixed/rename target scope, and concurrent parseable non-sensitive audit records.
- [ ] 1.7 Update Codex mirror/tripwire declarations for every new protected bridge file, verify no production auto-approval path exists, and make the targeted bridge, provider-adapter, Bash-policy, and mirror-sync suites pass from the focused committed bootstrap tip.

## 2. Documentation and final validation

- [ ] 2.1 Update the canonical harness documentation with the threat model, exact state lifecycle, immutable-byte and opened-inode rationale, 300-second expiry, root/subagent rules, audit location/fields, denial-observability limitation, cleanup/recovery, review workflow, and safe stale-state rotation.
- [ ] 2.2 Add the `codex-protected-approval` capability to `docs/capabilities.md` and align the concise repository guidance with the hardened invariants without changing Claude behavior or protected classifications.
- [ ] 2.3 Verify the operator documentation against the implemented state contract and run documentation lint, strict OpenSpec validation, and `git diff --check` without changing `sdk-navigation`.
