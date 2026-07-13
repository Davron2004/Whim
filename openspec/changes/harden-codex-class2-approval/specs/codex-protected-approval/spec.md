## ADDED Requirements

### Requirement: Trusted root registration
The system SHALL register protected-patch authority only from a trusted Codex root SessionStart event for the exact repository root, SHALL rotate a random session nonce on every registration, and SHALL treat the latest valid registration as the only current root identity.

#### Scenario: Root session registers
- **WHEN** a trusted root SessionStart event identifies the repository root, session, and transcript
- **THEN** the system atomically records a private root registration with a new random nonce and safe identity digests

#### Scenario: Registration is restarted or moved
- **WHEN** a request from an older registration, another root session, another worktree, a copied transcript, or a mismatched repository identity is presented
- **THEN** the system denies it, invalidates stale authority, and records an unauthorized-session event

#### Scenario: Subagent attempts registration
- **WHEN** a SessionStart event carries a registered agent identity or otherwise lacks unambiguous trusted root identity
- **THEN** the system denies registration without creating authority

### Requirement: Immutable exact-hash staging
Before native approval, the system MUST capture the candidate patch once into Git-common private storage, verify the supplied lowercase SHA-256 against the captured bytes, validate clean applicability and protected target scope, and publish only a regular permission-restricted object identified by that hash.

#### Scenario: Candidate is valid
- **WHEN** a root request supplies a regular non-symlink patch whose captured bytes match the expected hash and target only permitted protected files
- **THEN** the system atomically publishes the exact bytes as the immutable hash-addressed patch object and creates inert pending state

#### Scenario: Original path changes after staging
- **WHEN** the original candidate is modified, deleted, replaced, renamed, or swapped with a symlink after staging
- **THEN** approval and application continue to reference only the already captured protected bytes

#### Scenario: Candidate or protected object is unsafe
- **WHEN** a candidate or stored object is a symlink, non-regular file, hash mismatch, malformed patch, insecure state object, or cannot be safely published
- **THEN** the system denies before application, creates no redeemable authority, and records the specific rejection

### Requirement: Structurally inert pre-approval state
State created before the Codex Allow/Deny decision MUST NOT be redeemable authority, and only execution of the exact narrow helper after a current native approval SHALL be able to begin consumption.

#### Scenario: User approves
- **WHEN** native Codex approval starts the exact helper for a current valid pending request
- **THEN** the helper atomically transitions that request to consuming and performs at most one application attempt

#### Scenario: User denies or execution is interrupted
- **WHEN** the native prompt is denied, cancelled, interrupted, or the shell exits before the helper begins
- **THEN** no redeemable grant exists and any remaining pending request stays inert until invalidated or expired

#### Scenario: Later unrelated command observes an orphan
- **WHEN** a subsequent unrelated Bash hook or a new root registration observes pending state left by a denied or interrupted request
- **THEN** the system atomically invalidates and cleans that state, records orphan cleanup when observable, and does not authorize the unrelated command to redeem it

### Requirement: Atomic single-use consumption
Each successful human approval MUST authorize exactly one application attempt, and consumption MUST use a single-winner atomic filesystem transition before patch application.

#### Scenario: First redemption wins
- **WHEN** one approved helper atomically claims a current pending request
- **THEN** exactly that process may make one application attempt and the request ends in immutable applied or failed terminal state

#### Scenario: Replay is attempted
- **WHEN** the exact command, request identifier, original candidate, or patch hash is reused after consumption
- **THEN** the system rejects replay and requires a new request and human approval

#### Scenario: Concurrent redemption is attempted
- **WHEN** two helper processes attempt to consume the same pending request concurrently
- **THEN** at most one atomic transition succeeds and every loser fails without applying any bytes

### Requirement: Consumption-time identity and repository binding
Immediately before consumption and application, the system MUST match the request to the current trusted root registration, session nonce, transcript digest, repository common directory, root worktree, branch, and request-time HEAD without trusting caller-supplied environment identity.

#### Scenario: Identity remains current
- **WHEN** the consuming helper matches every bound identity and repository-state field
- **THEN** the system proceeds to integrity and scope validation

#### Scenario: Identity or repository state differs
- **WHEN** any required session, transcript, worktree, branch, Git-common directory, registration nonce, or HEAD value differs or is ambiguous
- **THEN** the system atomically invalidates the request, denies application, and records the mismatch

#### Scenario: Subagent requests or consumes authority
- **WHEN** a registered subagent invokes the helper, replays a root command, copies state, or supplies fabricated environment identity
- **THEN** trusted hook policy denies before prompting or consumption-time validation denies before application, and a subagent-attempt event is recorded when observable

### Requirement: Opened-object integrity and target scope
The system MUST revalidate the protected object’s type, ownership, permissions, exact SHA-256, patch form, allowed targets, and clean applicability immediately before consumption, and MUST apply bytes through descriptors opened on the verified inode without reopening the original or protected path.

#### Scenario: Protected copy is unchanged
- **WHEN** the protected object remains a valid exact-hash permitted patch
- **THEN** the system applies those opened bytes and records successful application

#### Scenario: Protected copy is tampered
- **WHEN** the protected object is modified, replaced, deleted, symlinked, has an unexpected type/mode/owner, or no longer hashes to the authorized value
- **THEN** the system fails closed before application and records integrity failure

#### Scenario: Target scope is wrong
- **WHEN** a patch targets an ordinary file, forbidden target, rename/copy, path escape, or a mixture containing any out-of-scope target
- **THEN** the system rejects the whole patch before prompting or applying it

### Requirement: Fixed expiration and stale cleanup
Pending and consuming state SHALL expire 300 seconds after recorded creation according to trusted local epoch time, SHALL never be refreshed, and SHALL require a new approval after expiry.

#### Scenario: Request is within lifetime
- **WHEN** all timestamps are valid integers and local time is no later than the recorded expiry
- **THEN** expiration alone does not prevent the current state transition

#### Scenario: Request is expired or timestamp is invalid
- **WHEN** local time exceeds expiry or a creation/expiry field is missing, malformed, inconsistent, or outside policy
- **THEN** the system denies, atomically invalidates stale state, safely cleans unreferenced objects, records expiration or malformed-state cleanup, and requires a new approval

### Requirement: Append-oriented security audit
The system SHALL write each security event as an independently complete, atomically published record in Git-private append-oriented storage, and authority creation or exercise SHALL fail closed if its required audit record cannot be written.

#### Scenario: Security transition is recorded
- **WHEN** request creation, approval start, consumption, application, expiry, hash mismatch, replay, unauthorized mismatch, subagent attempt, validation failure, or stale cleanup is observable
- **THEN** the system records timestamp, event type, request id, patch hash when applicable, safe session digest when applicable, and bounded non-sensitive context

#### Scenario: Denial is not directly observable
- **WHEN** native Codex denial prevents the helper from starting
- **THEN** the system records the later orphan invalidation/cleanup event and documentation identifies the denial-observability limitation

#### Scenario: Audit writers race
- **WHEN** multiple processes record events concurrently
- **THEN** every published record remains independently parseable with no partial or interleaved JSON

#### Scenario: Sensitive values are present in inputs
- **WHEN** patches, transcripts, tokens, paths, or environment values are processed
- **THEN** audit records omit patch bodies, raw transcripts, secrets, tokens, full paths, and environment dumps

### Requirement: Fail-closed private state
All authority-bearing state and its parent directories MUST be rooted beneath the resolved Git common directory with restrictive permissions, regular-file/directory and ownership checks, explicit schemas, complete temporary writes, and atomic publication; uncertainty MUST deny without direct-application fallback.

#### Scenario: State is valid
- **WHEN** directories and records have expected type, owner, mode, schema, fields, and relationships
- **THEN** the system may perform only the lifecycle transition permitted by the current state

#### Scenario: State is malformed or substituted
- **WHEN** JSON is truncated or malformed, required fields or hashes are invalid, state paths are symlinked, file types/modes/owners are unexpected, records conflict, or a write/rename/audit operation fails
- **THEN** the system denies, records a safe diagnostic when possible, and never falls back to applying the candidate directly

### Requirement: Narrow native approval and direct-edit denial
The production approval surface SHALL remain one narrowly parsed helper invocation bound to an absolute candidate path and exact SHA-256, SHALL prompt through native Codex policy on every new request, and SHALL keep all direct protected edits and generic shell-based alternatives denied.

#### Scenario: Exact root helper request
- **WHEN** the registered root submits the precisely formed helper command and all pre-prompt checks pass
- **THEN** Codex presents the user with Allow/Deny for that exact request

#### Scenario: Broad or malformed command is attempted
- **WHEN** a command adds shell syntax, changes the helper, omits or alters the hash, uses an unsafe path, or invokes a generic patch runner
- **THEN** policy denies without staging authority or presenting a protected-edit approval prompt

#### Scenario: Direct protected apply_patch is attempted
- **WHEN** any agent directly targets a Class-1 or Class-2 protected file through `apply_patch` or a shell write
- **THEN** the existing protection adapters deny it and do not downgrade the decision to reusable approval

### Requirement: Behavioral regression evidence
The repository SHALL maintain isolated behavioral tests that execute real bridge state transitions without mutating the developer checkout, and any test-only approval mechanism MUST be unreachable from production policy and entry points.

#### Scenario: Security matrix runs
- **WHEN** the targeted suite executes in isolated temporary repositories/worktrees
- **THEN** it proves success, direct denial, denial/interruption cleanup, original mutation/deletion/replacement/symlink swap, hash mismatch, protected tampering, replay, concurrent redemption, expiry, session mismatch/restart, subagent denial, malformed state, wrong/mixed scope, and concurrent audit behavior

#### Scenario: Production bypass is attempted
- **WHEN** a caller supplies a production environment variable or invokes a test-only transition outside a suite-created isolated repository
- **THEN** no automatic approval occurs and production policy remains the only approval boundary
