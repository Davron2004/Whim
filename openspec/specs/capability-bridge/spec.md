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

### Requirement: A host function exposed to a Playwright page is bound with main-frame provenance

A host function exposed to a Playwright-controlled page SHALL be installed via `exposeBinding`, never `exposeFunction`, and its callback SHALL reject as its first statement any invocation whose binding source is not the main frame — before any `JSON.parse` of the call's payload and before any dispatch. `exposeFunction` MUST NOT be used because it installs the binding on the global of every execution context reachable from the page, including the opaque-origin sandboxed iframe, and its wrapper discards the `{context, page, frame}` source Playwright provides for `exposeBinding` — that source is the only way to know which frame is calling. A refusal SHALL return `null` rather than throw, because Playwright's `deliverBindingResult` evaluates the return expression back inside the caller's realm, and an error there is an information channel into the untrusted caller. The callback's `source` argument SHALL be typed structurally rather than imported as `BindingSource`, since `playwright` does not re-export that type.

#### Scenario: A hostile caller from the sandboxed frame is refused before parsing

- **WHEN** a call arrives at the bound function whose binding source is not the main frame
- **THEN** the callback returns `null` without parsing or dispatching the payload, and no host-side effect occurs

#### Scenario: The legitimate main-frame caller is unaffected

- **WHEN** the outer page's own script invokes the bound function
- **THEN** the call is parsed and dispatched normally and yields a result

### Requirement: The bridge-invariants suite proves syscall authority against a hostile sandboxed caller

The bridge-invariants suite (`npm run bridge:invariants`) SHALL include a scenario in which code running inside the opaque-origin sandboxed frame attempts to invoke the host-side syscall dispatch directly, and SHALL assert three things together: that the refusal was observed, via an explicit refusal counter, since a returned `null` is indistinguishable from a silent no-op at the call site; that the attempted state change is absent when read back from the storage engine itself, not merely absent from an in-memory trace of dispatched calls; and that a positive control — the same syscall issued through the legitimate main-frame relay — succeeds and its effect is visible on that same readback.

#### Scenario: A hostile in-sandbox caller is refused and leaves no trace

- **WHEN** the adversarial fixture running inside the sandboxed frame issues a syscall frame directly to the host dispatch channel
- **THEN** the suite's refusal counter records the refusal, and reading the target state back from the storage engine shows no change

#### Scenario: The legitimate path still succeeds

- **WHEN** the same syscall is issued through the sandbox's own shim over the legitimate main-frame relay
- **THEN** the call succeeds and the resulting state is visible on readback from the storage engine

### Requirement: The fast gate statically rejects unguarded Playwright host bindings

The fast gate SHALL run a structural, AST-based check over every `.ts` and `.mjs` source file in the repository, whether or not it imports `playwright` (a helper handed a page need not), and SHALL fail if a file references `exposeFunction`, or calls `exposeBinding` with a callback whose first statement is not a main-frame provenance rejection. The check SHALL be AST-based rather than string- or regex-based, so that reformatting the call or renaming a local variable cannot defeat it. The check SHALL cover directories ESLint does not lint — `invariants/` is listed in `.eslintignore`, so ESLint provably cannot see a violation there. The check's own suite SHALL include a hostile fixture containing both an unguarded `exposeFunction` call and an `exposeBinding` call whose provenance rejection is placed after a `JSON.parse` rather than first, and SHALL assert the check flags both while a correctly-guarded `exposeBinding` passes.

#### Scenario: An unguarded exposeFunction is flagged

- **WHEN** a `.ts` or `.mjs` source file calls `exposeFunction`
- **THEN** the fast gate fails, naming the file and line

#### Scenario: A late provenance check is flagged

- **WHEN** a file calls `exposeBinding` with a callback that parses or dispatches before rejecting non-main-frame callers
- **THEN** the fast gate fails, naming the file and line

#### Scenario: The check itself is proven non-vacuous

- **WHEN** the check's own suite runs against the hostile fixture
- **THEN** both the unguarded `exposeFunction` and the late-guard `exposeBinding` are flagged, and a correctly-guarded `exposeBinding` passes

