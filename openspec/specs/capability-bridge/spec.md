# capability-bridge Specification

## Purpose
TBD - created by archiving change capability-bridge. Update Purpose after archive.
## Requirements
### Requirement: Native-backed effects flow through one governed syscall boundary

Every native-backed capability a mini-app uses SHALL be reachable only as a syscall: a versioned request/response envelope over the string transport, dispatched by the host against an append-only capability registry. There MUST be no other path from bundle code to a host-side capability, and adding a new capability MUST require only a new registry row plus a client stub — never changes to transport or dispatcher.

#### Scenario: Storage is reachable only as syscalls

- **WHEN** a mini-app declaring the storage capability calls the SDK storage verbs
- **THEN** each call crosses the bridge as a syscall envelope, executes against host-side storage, and resolves the stub's Promise with the result — and no storage effect is achievable from the bundle through any other mechanism

#### Scenario: A second capability is one row and one stub

- **WHEN** a new capability is added to the registry (e.g. a trivial diagnostic method) with its handler and required capability
- **THEN** it is immediately gateable and callable through the existing transport and dispatcher with no modification to either

### Requirement: Syscall identity is derived from the channel, never the message

The syscall envelope SHALL carry no app identifier, store address, or realm identifier settable by the bundle. The host MUST resolve the calling app from the channel the frame arrived on (which realm/WebView delivered it), and each realm's dispatcher MUST be bound at realm creation to exactly that app's manifest and capability handles.

#### Scenario: A cross-app request is inexpressible

- **WHEN** a hostile bundle crafts raw syscall frames with arbitrary extra fields (app names, paths, ids) attempting to address another app's storage
- **THEN** the extra fields have no effect — the syscall executes (or is denied) strictly against the calling realm's own bound handles, and no other app's data is readable or writable

### Requirement: The gate enforces the host-held manifest with structured errors

Before dispatch, the host SHALL verify the method is registered, the method's required capability is declared in the **host-held** manifest for the calling realm, and the params match the registered shape. A bundle's runtime self-description MUST NOT be consulted for gating. Every denial MUST be a structured error carrying a machine-readable kind and a fix hint.

#### Scenario: An undeclared capability is denied with a fix hint

- **WHEN** a mini-app whose host-held manifest lacks `storage` calls a storage verb
- **THEN** the syscall is refused before any handler runs, and the stub's Promise rejects with a structured error naming the missing capability and hinting at the manifest declaration

#### Scenario: A self-declared manifest gates nothing

- **WHEN** a hostile bundle claims capabilities at runtime (in its AppSpec or in crafted frames) that the host-held manifest does not contain
- **THEN** gating decisions are unchanged — only the host-held manifest is consulted

### Requirement: Syscall delivery is idempotent within a realm generation

The dispatcher SHALL deduplicate syscalls by request ID within a realm generation: a request ID already executed MUST NOT re-execute its handler, and the recorded outcome SHALL be replayed instead.

#### Scenario: A retried append does not double-append

- **WHEN** the same `storage.records.append` syscall frame (same request ID, same generation) is delivered twice
- **THEN** exactly one record exists, and both deliveries observe the same result

### Requirement: Realm generations are fenced

Each realm reset SHALL start a new generation with a fresh request-ID space and an empty dedup state. Frames from a previous generation MUST be dropped, and a handler result completing after its realm is torn down MUST NOT be delivered into a successor realm.

#### Scenario: A stale in-flight syscall cannot leak across a reset

- **WHEN** a syscall is in flight while its realm is reset and a new generation boots
- **THEN** the old generation's frames and late results are discarded — the new generation observes no response it did not request

### Requirement: In-sandbox stubs hold no ambient authority

The SDK client stubs SHALL hold no capability stronger than the one-way string transport, and frame families MUST NOT cross: control-frame handling ignores syscall-shaped frames, syscall handling ignores control frames, and a forged response from bundle scope cannot resolve a stub Promise the stub did not issue.

#### Scenario: The stub layer yields no escalation

- **WHEN** a hostile bundle enumerates everything reachable from the injected SDK storage facade (own properties, closures via accessible functions, prototypes)
- **THEN** nothing reachable grants more than the ability to post strings to the host — no engine handle, no host object, no native reference

#### Scenario: A forged sysret is inert

- **WHEN** bundle code dispatches a fabricated `sysret` frame into the iframe targeting a pending or invented request ID
- **THEN** no stub Promise resolves with attacker-controlled data — responses are accepted only from the host-side channel

### Requirement: A mini-app with storage declared is a real app across restarts

With the bridge and storage wired end-to-end, a mini-app declaring the storage capability SHALL persist user data across a full app process kill on the real device target.

#### Scenario: The water counter survives a kill

- **WHEN** the water-counter fixture increments its count, the host app process is killed, and the app is relaunched
- **THEN** the counter shows the persisted count, restored through syscalls against the same per-app store

### Requirement: A hostile bundle cannot inject SQL through the storage verbs

A mini-app driving the legitimate storage verbs with adversarial input SHALL NOT be able to alter, read around, or corrupt storage through SQL injection. Hostile values MUST round-trip as inert literals, and hostile collection/field names MUST be rejected as structured errors — never reach a SQL statement string. This property MUST be exercised end-to-end through the real sandbox→syscall→engine path, not only at the engine API.

#### Scenario: An evil mini-app's injection attempts are inert end-to-end

- **WHEN** an adversarial fixture mini-app (alongside the existing sandbox-escape fixtures) calls storage verbs with SQL metacharacters in record values, kv keys/values, filter values, and crafted collection/field names
- **THEN** values round-trip byte-identical, crafted identifiers yield structured `unknown_field`/`unknown_collection` errors, no unintended table is dropped/read/written, and the app's own store is the only store touched

### Requirement: Bridge security properties are never-regress invariants

The gate-denial, stub-authority, forged-response, generation-fence, and end-to-end SQL-injection properties SHALL be encoded in the blocking invariant suite, including a negative control proving the suite detects a broken gate.

#### Scenario: A broken gate is flagged red

- **WHEN** the invariant suite runs against a deliberately misconfigured gate that grants undeclared capabilities
- **THEN** the suite fails loudly on that scenario while the correctly-configured scenarios pass
