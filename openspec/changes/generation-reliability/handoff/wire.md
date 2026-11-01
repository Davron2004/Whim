# handoff/wire.md — chain-wire writes-contract (interface only)

Consumers: chain-upstream (terminal `cause`, 503 routes), chain-breaker (admission refusal).

## Contract (`contract/src/index.ts`)

```ts
export const PROTOCOL_LEVEL = 2;
export const ServiceRefusalCode = z.enum([
  'payload_too_large', 'daily_limit', 'device_busy', 'server_busy', 'content_policy',
  'policy_unavailable', 'budget_exhausted', 'update_required', 'consent_required',
  'provider_unavailable',            // 503, introduced at level 2
]);
export const FailureCause = z.enum(['provider_unavailable']);   // closed; grows only additively
export type FailureCause = z.infer<typeof FailureCause>;
// GenerationEvent 'failure' arm: { type, reason, attempts, diagnostics, cause?: FailureCause, compat? }
```

`CompatFallback` is untouched (frozen).

## Hint sentence (`REFUSAL_HINTS.provider_unavailable`, `server/src/admission/refusals.ts`)

`The AI service Whim uses is having trouble right now. It’s not something you did. Please try again in a little while.`

(U+2019 apostrophe in "It’s". Exact string; no vendor, model or status. The device test pins the same literal.)

## Refusal builder (`server/src/admission/refusals.ts`)

```ts
export function providerUnavailableRefusal(retryAfterSeconds?: number): ServiceRefusal;
// status 503; body { error: 'provider_unavailable', hint: REFUSAL_HINTS.provider_unavailable }
// headers: { 'Retry-After': String(retryAfterSeconds) } only when the argument is given, else {}
// The caller passes whole seconds (already rounded up); the builder does not round or clamp.
```

`ServiceRefusal['status']` already allowed 503; no type change.

## Registry (`server/src/wire-level.ts`)

```ts
ERROR_LEVELS.provider_unavailable = {
  level: 2,
  compat: { min: 2, fallback: 'fail', notice: REFUSAL_HINTS.provider_unavailable },
};
EVENT_LEVELS.failure = { level: 1, fields: { cause: 2 } };
```

Field-level gating member on `WireEntry<M>`:

```ts
readonly fields?: Readonly<Record<string, number>>;   // field name -> level it was introduced at
```

`forLevel` (used by `eventForLevel` and `errorForLevel`): when `entry.level <= clientLevel` the message is
returned with every `entry.fields` key whose level is above `clientLevel` deleted (other fields untouched, a
message without the key is returned as-is), then `withCompat`. A message above the client's level takes the
unchanged `downgrade`/envelope path. `eventForLevel` stays the single exit of `routes/generate.ts`
(`forClient`), so a producer sets `cause` and the route strips it for a level-1 request: no route change.

Resulting wire:
- `errorForLevel(providerUnavailableRefusal().body, 1)` -> `{ error, hint, compat: { min: 2, fallback: 'fail', notice: <hint> } }`
- levels 2 and 3 -> `{ error, hint, compat }` too (same object: the entry carries `compat`, so `withCompat` attaches it at every level)
- `eventForLevel(failureWithCause, 1)` -> the failure without `cause`; levels 2, 3 keep it; a failure with no `cause` is identical at every level
- a request declaring `x-whim-protocol: 3` is admitted and served (no upper bound on the header)

## Device

- `src/host/launcher/wire-headers.ts`: `PROTOCOL_LEVEL = 2`.
- `wire-compat.ts` `KNOWN_ERROR_CODES` gains `'provider_unavailable'` (a test holds it equal to the registry at the device's level).
- `service-refusal.ts`: `REFUSAL_RULES.provider_unavailable = { landing: 'sender', tone: 'neutral' }` (no `text`: the server hint shows verbatim). Retry-After handling is code-agnostic.
- `generation-client.ts`: `EVENT_OPTIONAL.failure = { cause: true, compat: true }`; a private `FAILURE_CAUSES: Record<FailureCause, true>` set; `knownEventOf` for a `failure` drops a `cause` outside that set (via `withoutMalformedOptional`, a warn log naming route and field only) and keeps the rest of the event. `null` reads as absent.
- `pending-builds.ts`: `export type PendingFailureCause = 'connection' | 'provider_unavailable'` (stored on `PendingBuildFailure.cause`).
- `LauncherRoot.tsx`: the terminal `failure` handler passes `cause: terminal.cause` to `showStreamFailure` -> `settleFailed`; `rephraseHelps` is `remedy == null && cause !== 'provider_unavailable'` at both sites (live failure; `failureFromRecord` for a tile). `failureKindOf`/`failureActions` are unchanged: kind `other`, first action "Try again", no "Change the description". No report action is reachable from the Failure page.

## Invariants chain-upstream must keep

- Only the `provider_unavailable` terminal sets `failure.cause`; the machine writes the event with `cause` and never gates it itself (the route does).
- A server that sets `cause` for a level-1 client is safe: the route strips it. Do not special-case levels in the machine.
- Fixtures that need "a level the server does not have" use `PROTOCOL_LEVEL + 1` (= 3), never a literal 2.
