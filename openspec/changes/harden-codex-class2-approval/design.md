## Context

The bridge spans trusted Codex hook payloads, native exec-policy approval, a narrow helper, and Git-private state. Today the PreToolUse authorizer both snapshots the patch and creates the hash-named grant before the native prompt; a denied prompt therefore leaves redeemable authority until another Bash hook sweep. The helper also reopens a mutable snapshot and consumes its grant with check-then-delete, while consumption does not revalidate the registered root identity (see [research.md](research.md), “Current behavior” and “Risks and unknowns”).

Class-2 control-plane files cannot be changed by implementer subagents. This change therefore requires one exact, manually reviewed HUMAN-BOOTSTRAP patch for the core bridge and its proving tests. Only after that bootstrap is installed may later protected polish use the hardened lane. The working tree must remain on `main`, the prompt must remain native Codex Allow/Deny, direct protected `apply_patch` must remain denied, and Claude policy behavior must not change.

## Goals / Non-Goals

**Goals:**

- Make pre-prompt state non-redeemable and bind post-prompt execution to the exact staged bytes, registered root session, request-time repository state, and a 300-second lifetime.
- Make one application attempt an atomic, single-winner state transition that rejects replay and concurrent redemption.
- Eliminate path-substitution TOCTOU by applying through file descriptors opened on one verified protected inode, never by reopening the candidate path.
- Fail closed on ambiguous identity, malformed or unsafe state, target-scope violations, audit failures, expiry, tampering, and cleanup failures.
- Provide behavioral tests for every claimed security invariant and append-oriented, non-sensitive audit evidence.

**Non-Goals:**

- Granting subagents any Class-2 authority or making protected edits non-interactive.
- Protecting against the human repository owner or an arbitrary same-user process that can directly rewrite the checkout and Git-private state outside Codex.
- Generalizing the helper into a shell, patch runner, reusable command-prefix grant, or product capability.
- Changing Claude hooks, protected classifications, parked worktrees, or the `sdk-navigation` change.

## Decisions

### 1. Separate inert requests from executable authority

The authorizer will create only an immutable hash-addressed patch object and a `pending` request. A pending request records a schema version, request id, patch hash, root-session nonce and safe session digest, transcript digest, root worktree path, Git-common path digest, request-time HEAD, candidate-display digest, and integer creation/expiry timestamps. It is not a grant and no lower-level redemption command accepts pending state.

The narrow helper process starts only after native Codex approval. Its first authority-changing action is an atomic rename of the one matching pending record into a unique `consuming` path. That transition represents approval and consumption together: there is no reusable approved-file interval. A second helper cannot rename the same record and fails as replay/concurrent redemption. The one attempt ends in an immutable `consumed` terminal record with `applied` or `failed`; it is never moved back.

Alternative considered: create a grant in PreToolUse and delete it on denial. Codex does not invoke the helper after denial, so reliable synchronous deletion is unavailable and the pre-prompt grant is structurally unsafe.

### 2. Stage once, authorize exact bytes, and apply one opened inode

The authorizer rejects symlink/non-regular candidates, copies the candidate once into an exclusively created private temporary file under the Git common directory, and treats those captured bytes as authoritative. It hashes and validates that file, then atomically publishes it as `patches/<sha256>.patch` with restrictive mode. Existing objects are accepted only when regular-file, ownership, mode, and content-hash checks all pass.

The original candidate path is never opened by the helper. After approval, the helper validates the protected object and opens all file descriptors needed for hash, syntax/scope checks, applicability, and final `git apply` before consuming input. Each operation reads the already-opened inode rather than resolving the protected pathname again. Hash and target validation are repeated immediately before the atomic consuming transition; the final apply reads an opened descriptor.

Alternative considered: validate by path and reopen for `git apply`. A concurrent rename can swap a different inode between checks, which is the reported protected-copy TOCTOU.

### 3. Rotate a trusted session nonce and bind each request to repository state

Root SessionStart will generate a cryptographically random nonce and atomically replace the sole registered root record. Registration remains based on trusted hook fields: root-only event, empty agent id, exact repository root, session id, and transcript. Every pending request includes that nonce and safe digests of the identity fields. The helper requires an exact match with the current regular, private root record, the same worktree root/Git common directory, `main`, and the request-time HEAD.

Re-registration changes the nonce and makes all prior pending/consuming authority invalid. Cleanup moves stale records to terminal invalid state and audits the rotation. Caller-controlled environment variables never establish identity.

Alternative considered: trust a session id argument or environment variable. Subagents can fabricate those values; only hook-written registration is trusted.

### 4. Use Git-common private state with centralized validation

State lives below `$(git rev-parse --git-common-dir)/codex-protected-approval/` in separate `sessions`, `patches`, `pending`, `consuming`, `consumed`, `invalid`, `locks`, and `audit/events` directories. Initialization uses `umask 077`, canonical Git paths, regular-directory checks, and restrictive ownership/mode checks. Writes use `mktemp` in the destination directory, complete fsync/best-effort durability where available, and atomic rename. Authority-bearing symlinks, hard-link anomalies where detectable, malformed JSON, unknown schema versions, non-integer timestamps, unexpected fields/types, or insecure permissions are fatal.

Common parsing, validation, audit, expiry, and cleanup functions live in a small sourced bridge library whose own path/type/ownership are verified by each entry point. This centralizes the security decisions without widening the callable command surface.

### 5. Expire without refresh and clean denial-observable orphans

The lifetime is exactly 300 seconds from recorded creation using local epoch time. It is checked before staging conflicts, before the consuming transition, and before application; it is never refreshed. Expired pending/consuming state moves atomically to `invalid`, its patch object is removed only when no live state references it, and an expiration/cleanup event is recorded.

Every Bash PreToolUse invocation performs bounded cleanup before command authorization. An unrelated command invalidates all non-current pending state, which makes denied/interrupted requests observable later without making them redeemable in the meantime. If Codex denial prevents command execution, no synchronous denial event is possible; audit records the later `orphan_cleanup` with a denial/interruption-unknown reason. Session registration also invalidates prior-session state.

### 6. Make audit records independently atomic

Rather than concurrent writers appending fragments to one JSONL file, each event is a complete JSON object written to an exclusive temporary file and atomically renamed into `audit/events/<time>-<nonce>.json`. The directory is the append-oriented audit log; records are never updated in place. Each record contains schema version, epoch timestamp, event type, request id, patch hash when known, safe session digest when known, and a bounded diagnostic code. It never contains patch bytes, raw transcripts, tokens, candidate paths, or environment dumps.

Security-relevant state transitions require a successful audit write before continuing where failure would hide newly created or exercised authority. Rejection logging is best effort only when the log itself is the failing component; the operation still denies.

### 7. Keep production approval unmockable

Production entry points have no auto-approve environment variable. Tests construct isolated repositories and call lower-level state functions through a test driver that verifies an unforgeable test fixture marker: the repository must be under the suite-created temporary root, Git common state must be empty at setup, and the driver itself is not installed or accepted by production policy. Native prompt behavior remains covered by exact policy/adapter tests; state transitions use the explicit test driver.

## Risks / Trade-offs

- **[Codex denial is not synchronously observable]** → Pending is inert, later hook/session cleanup is audited, and documentation states the limitation explicitly.
- **[A crash after atomic consumption prevents retry]** → Consumption authorizes one attempt, not one success; terminal failure requires a fresh prompt, which is safer than replay.
- **[Git-private objects are writable by the repository owner]** → Restrictive mode, ownership/type checks, opened-inode application, and repeated hashing detect accidental or agent-mediated tampering; arbitrary owner compromise remains outside the threat model.
- **[Strict HEAD binding can reject approval after unrelated commits]** → Fail closed and request a fresh approval; the expected prompt window is short.
- **[Per-event audit files require tooling to inspect as a stream]** → Provide a documented deterministic `find`/sort inspection command and validate every event independently in tests.
- **[The existing bridge cannot safely approve its own replacement]** → Deliver the smallest complete core plus proving tests as one manually reviewed HUMAN-BOOTSTRAP patch; do not use the vulnerable grant path for bootstrap.

## Migration Plan

1. Create and review one exact bootstrap patch containing the state library, three bridge entry points, production policy/mirror declarations needed by them, and the critical behavioral suite.
2. Apply it manually in an attended root session, commit the protected diff, and immediately run targeted bridge/adapter tests plus mirror synchronization.
3. Use the hardened lane for any subsequent protected documentation/gate polish, each with a fresh hash and prompt.
4. Run lint, `git diff --check`, OpenSpec validation, the authoritative fast gate, and audit/state cleanup checks from the committed protected tip.
5. Rollback is a normal human-reviewed revert commit; never restore or reuse old pending/consumed state. Rotation/cleanup after rollback is mandatory.

## Open Questions

None. The helper continues to accept the repository’s existing protected union (Class 1 and Class 2), while its documentation emphasizes that Class 2 always requires attended root ratification. Multiple simultaneous root sessions are intentionally last-registration-wins and older session state is invalidated.
