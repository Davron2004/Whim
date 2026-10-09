# Contract: connectivity-state (chain-3 → chain-5)

Interface only; rationale is `design.md` decisions 4-6 and `src/host/launcher/connectivity.ts`'s
own doc comments.

## The state type

```ts
// src/host/launcher/connectivity.ts
export type Connectivity = 'unknown' | 'checking' | 'online' | 'offline';
```

- `'unknown'`: no server address is configured (`clientOptions == null`). Never reached again
  once an address is configured for the session — distinct from `'offline'`.
- `'checking'`: the startup probe is in flight, once.
- `'online'`: reached and reached exactly once per session (the retry loop schedules nothing
  further after this, per any of: a verified probe, an unverified-but-200 probe, or a real
  `clarifyPrompt`/`generateApp` call completing).
- `'offline'`: the configured address failed its most recent probe; a retry is scheduled.

## Where it lives

`LauncherShell` (`LauncherRoot.tsx`, the function under the `LauncherRoot` default export) holds:

```ts
const [connectivity, setConnectivity] = useState<Connectivity>('unknown');
```

It is plain component state, not exported from any module — a consumer screen only ever reads it
as a **prop LauncherRoot passes down**, the same shape as the existing
`serverConfigured={clientOptions != null}` prop `ComposeStep` already receives from this same
component. There is no other read path (no context, no external store) — `connectivity` lives and
dies with the `LauncherShell` instance for the process lifetime of the session.

## `markOnline()`

```ts
const markOnline: () => void;
```

Defined in `LauncherShell`, backed by `ConnectivityLoop.markOnline()` (`connectivity.ts`) through
a ref. Cancels any pending scheduled retry and transitions `connectivity` to `'online'`.
Idempotent — a no-op once already `'online'`, and a no-op when no server address is configured
(no loop is running). Not exported; not needed outside `LauncherRoot.tsx` — chain-5 only needs to
read `connectivity`, never to call this.

Already wired into both of `LauncherRoot.tsx`'s generation-client call sites (a resolved
`clarifyPrompt`, and a `generateApp` stream loop that completes without throwing a
transport-classified error) — chain-5 does not need to add or touch either call site.

## How chain-5 reads the current state

`connectivity` is not yet threaded to any child screen — this chain (chain-3) only establishes it
as `LauncherShell` state and wires its producers (the startup/retry loop, `markOnline()`). Chain-5
adds the consumer side:

- **`HomeScreen`** (task 5.1): `LauncherRoot.tsx`'s existing `<HomeScreen ... />` call site gets a
  new `connectivity={connectivity}` (or a narrower boolean the screen derives, e.g.
  `offline={connectivity === 'offline'}` — implementer's choice) prop; `HomeScreen.tsx`'s prop
  type gains the field to accept it.
- **Prompt-flow entry screen** (task 5.2, `ComposeStep.tsx`): the same pattern as the existing
  `serverConfigured={clientOptions != null}` prop already passed at
  `<ComposeStep serverConfigured={clientOptions != null} ... />` — add a sibling prop sourced from
  `connectivity` (e.g. `serverUnreachable={connectivity === 'offline' && clientOptions != null}`)
  rather than passing the raw union and re-deriving the condition inside the screen, matching how
  `serverConfigured` is already a derived boolean, not the raw `clientOptions`.

Both are ordinary prop threading through call sites `LauncherRoot.tsx` already owns — no new
state, no new subscription mechanism, no import of `connectivity.ts`'s `ConnectivityLoop` (that
class is fully internal to chain-3's effect and never needs to leave `LauncherRoot.tsx`).

## Non-obligations

- No consumer needs `'checking'` specifically distinguished from `'unknown'` unless a design
  later asks for a checking-specific affordance — spec's two offline-UX surfaces (indicator,
  notice) only key off `'offline'` (and, for the notice, "an address is configured" alongside it).
- `ConnectivityLoop`, `backoffDelayMs`, and `TimerLike` (`connectivity.ts`) are implementation
  detail of the retry loop itself — not part of this contract, not needed by chain-5.
