# Research digest: What exists in the Codex Class-2 approval bridge, and what must hardening preserve?

## Relevant files

- `docs/capabilities.md:1-24` indexes product capabilities; no coding-harness or protected-approval capability currently exists.
- `docs/harness.md:79-107,195-223` is the canonical Class-2 and Codex mirror description.
- `.codex/hooks/register-root-session.sh:6-27` records the root session/transcript in Git-common private state.
- `.codex/hooks/authorize-protected-patch.sh:15-70` parses the exact helper command, checks hook identity/hash, snapshots bytes, and creates authority.
- `.codex/hooks/apply-reviewed-protected-patch.sh:21-66` validates and applies the snapshot.
- `.codex/hooks.json:13-45` wires Bash PreToolUse authorization and root SessionStart registration.
- `.codex/rules/protected-patch.rules:1-5` makes the exact helper path prompt through native Codex approval; `.codex/config.toml:1-2` selects the user as reviewer.
- `.codex/hooks/protect-harness.sh:16-44` adapts Codex `apply_patch`; `.claude/hooks/protect-harness.sh:62-134` contains canonical protected-file policy.
- `.claude/hooks/bash-policy.sh:143-163` blocks shell writes to protected paths; `.codex/hooks/bash-policy.sh:1-11` is its Codex adapter.
- `.codex/hooks/test/protected-patch.test.sh:1-149` is the isolated stateful bridge suite.
- `.codex/hooks/test/provider-adapters.test.sh:1-66` covers provider decisions and direct-patch denial.
- `scripts/gate.sh:23-37,64-66` protects harness diffs and runs both Codex suites.
- `scripts/sync-codex.mjs:45-68` requires all seven bridge/adapter programs to be regular executable files.
- `scripts/fixloop.sh:40-59` defines authoritative Class-2/Class-1 integrity sets.
- `openspec/schemas/whim-harness/schema.yaml:282-345` defines chain partitioning and HUMAN-BOOTSTRAP treatment.

## Current behavior

- SessionStart accepts only non-agent events whose `cwd` equals the repository root, then atomically replaces `root-session.json` with session, transcript, and registration time (`register-root-session.sh:8-27`).
- Bash PreToolUse runs canonical Bash policy and the protected-patch authorizer (`hooks.json:13-24`).
- The authorizer first deletes all top-level `grant-*.json` and `reviewed-*.patch` files, then accepts only an exact helper invocation with an absolute restricted-character patch path and lowercase SHA-256 (`authorize-protected-patch.sh:20-35`).
- Trusted hook payload supplies session, transcript, turn, cwd, and agent identity; all must match the root registration and `agent_id` must be empty (`authorize-protected-patch.sh:38-52`).
- Before the native prompt, the authorizer hashes the original, copies it to `reviewed-<hash>.patch`, rehashes the copy, and creates `grant-<hash>.json` (`authorize-protected-patch.sh:44-70`).
- The exec-policy prefix then prompts the user (`protected-patch.rules:1-5`); denial means the helper never runs.
- On execution, the helper checks grant/snapshot existence, snapshot hash, five-minute age, `main` branch, clean applicability, no rename/copy, and target allowlist (`apply-reviewed-protected-patch.sh:21-61`).
- It deletes the grant with `rm -f`, applies the snapshot, and removes grant/snapshot again through an EXIT trap (`apply-reviewed-protected-patch.sh:27-28,63-66`).
- Direct protected `apply_patch` remains denied because canonical `ask` cannot be represented by Codex PreToolUse (`translate-pre-tool-use.sh:44-56`).
- Current targeted results: protected-patch suite 11/11 passed; provider-adapter suite 13/13 passed; `sync-codex --check` passed.
- The 11 stateful cases cover root registration, subagent registration isolation, snapshot/grant creation, next-Bash orphan cleanup, hash mismatch, malformed command, subagent denial, original-path mutation, replay, ordinary-target rejection, and rename rejection (`protected-patch.test.sh:46-149`).

## Constraints and invariants

- Class 2 is human-ratified control-plane code; subagents are categorically denied and an attended root task may use only the exact reviewed-patch lane (`docs/harness.md:21-24,83-88`).
- Canonical Class 2 includes gate/fixloop/sync scripts, `.claude/**`, `.codex/**`, `invariants/`, and `build/` (`docs/harness.md:83-88`; `scripts/fixloop.sh:47-53`).
- Class 1 includes package, TypeScript, lint, knip, Babel, and Metro configuration (`docs/harness.md:89-92`; `scripts/fixloop.sh:54-58`).
- The helper currently accepts the union of Class 1 and Class 2 despite its Class-2 naming and diagnostic (`apply-reviewed-protected-patch.sh:52-57`).
- Git-common state is shared across linked worktrees; all three bridge programs resolve it with `git rev-parse --git-common-dir`.
- Protected changes make the fast gate refuse to run while they differ from its baseline (`scripts/gate.sh:23-37`).
- OpenSpec apply must never implement inline; Class-2 chains are HUMAN-BOOTSTRAP (`openspec/schemas/whim-harness/schema.yaml:313-315,335-345`).
- Existing Claude policy behavior, worktree isolation, direct-edit denial, parked worktrees, and the unrelated `sdk-navigation` state must remain unchanged.

## Integration points

- Native approval is outside the scripts: PreToolUse stages state; the exec-policy prompt decides whether the helper process starts.
- PermissionRequest handling delegates unknown/ask decisions to Codex while preserving canonical allow/deny semantics (`permission-request.sh:1-11`; `translate-pre-tool-use.sh:57-64`).
- The fast gate directly invokes the protected-patch and provider-adapter suites, so no package-script entry is currently required (`scripts/gate.sh:64-66`).
- Full-gate mirror enforcement reaches the bridge through `scripts/sync-codex.mjs --check` (`docs/harness.md:218-223`).
- `docs/harness.md:211-217` and `CLAUDE.md:21` currently claim immutable snapshot, denial cleanup, replay/TOCTOU protection, and 11 stateful cases.
- The schema’s Class-2 examples omit `.codex/**` and `scripts/sync-codex.mjs`, although the canonical enforcement map classifies both as Class 2 (`schema.yaml:313-315`; `docs/harness.md:83-88`).

## Risks and unknowns

- A grant is created before human approval. Denial skips the helper and its EXIT trap, leaving authority until a later Bash PreToolUse sweep (`authorize-protected-patch.sh:20-22,60-70`).
- The snapshot remains mutable and is reopened separately for hash check, rename scan, applicability check, target enumeration, and final apply; concurrent replacement between those operations is a protected-copy TOCTOU (`apply-reviewed-protected-patch.sh:30,39-43,60,65`).
- Consumption is check-then-`rm -f`, not an atomic claim; concurrent helpers can both pass the existence checks (`apply-reviewed-protected-patch.sh:26-30,63-65`).
- Grant JSON records session/transcript/turn, but the helper validates only its hash and timestamp; it does not compare identity against current root registration (`authorize-protected-patch.sh:62-68`; `apply-reviewed-protected-patch.sh:29-36`).
- Root re-registration overwrites only `root-session.json`; it does not itself invalidate existing grants or snapshots (`register-root-session.sh:19-27`).
- State creation uses predictable PID temporary names and does not reject a pre-existing symlinked state directory or temporary destination.
- There is no audit log or explicit pending/approved/consumed state separation.
- The existing original-path mutation test proves post-snapshot mutation resistance, not deletion/replacement/symlink swap or protected-snapshot tampering (`protected-patch.test.sh:94-99`).
- Existing tests do not cover concurrent redemption, controlled expiry, restart/session mismatch at consumption, malformed state, state symlinks/types/permissions, audit concurrency, mixed scope, or interruption without a later Bash event.
- The successful application test patches `.eslintrc.js`, which canonical policy classifies as Class 1, not Class 2 (`protected-patch.test.sh:17,56-72`; `docs/harness.md:89-92`).
- Tests call the production helper directly after simulated authorization; they do not exercise the interactive native prompt.

## Open questions for the planner

- Codex denial is not directly observable when the prompted command never starts; only later hook activity can observe stale pre-prompt state.
- The trusted process-level signal available to the helper after native approval is not documented in the repository; trusted session identity currently exists only in hook payload and Git-private registration.
- The intended helper scope—Class 2 only or the current Class-1/Class-2 union—is inconsistent between naming/documentation and its allowlist.
- Multiple root Codex sessions sharing one Git common directory overwrite a single registration record; the intended concurrency policy is not specified.
