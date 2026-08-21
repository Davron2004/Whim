# Contract — host-side frame provenance (chain-1)

The interface chain-2 asserts against. Everything a test needs is here; do not re-derive it.

## The two guards

| channel | file:line | predicate | on refusal |
| --- | --- | --- | --- |
| relay | `synthrun/observe.ts:491` | `source.frame !== page.mainFrame()` | `return` (no value) |
| dispatch | `synthrun/capability.ts:153` | `source.frame !== source.page.mainFrame()` | `return null` |

Both are the FIRST statement of an `exposeBinding` callback (`observe.ts:490`, `capability.ts:145`),
so refusal happens before `JSON.parse` / before `dispatcher.handle`. `source` is Playwright's
`{context, page, frame}`, typed structurally (`BindingSource` is not re-exported by `playwright`).
Frame identity is browser-derived, so it cannot be forged from the candidate realm.

Provenance is an **additional** necessary condition, not a replacement: a frame must be BOTH
main-frame-originated AND `trusted:true`. `msg.trusted` handling is unchanged.

## Observable shape of a REFUSED relay frame

Only two fields of `ObservationState` move, both saturating at `REJECTED_FORGERY_CAP` (16):

```ts
state.rejectedForgeries        // +1  — existing field, surfaces as RunReport.forgeries.count
state.hostProvenanceRefusals   // +1  — ADDITIVE field (observe.ts:105), the 1.2 distinguisher
```

`hostProvenanceRefusals?: number` is **optional** purely so hand-built `ObservationState` literals
(e.g. `stubObservers()` in the suite) still typecheck; `attachObserversEarly` always initialises it
to `0` (`observe.ts:433`), so on a real run `undefined` never occurs. Read it as
`obs.state.hostProvenanceRefusals`.

Prefer it over `rejectedForgeries` for assertions: `rejectedForgeries` is noisy — `probes.js`'s own
T6b pen test posts a spoof frame from every realm, so every healthy run already carries ≥1.
`hostProvenanceRefusals` counts host-side refusals **only**, so `=== 1` is a stable assertion.

Everything else is untouched by the refusal path, and these are the assertions that show the frame
did not reach the observation state:

- `state.events` — no event appended (length unchanged, no new `probes`/`rejected-forgery` entry)
- `state.contained` — unchanged
- `state.diagnostics` — unchanged
- `state.paintAtMs`, `state.lastActivityAtMs` — unchanged (a refused frame cannot hold the quiet
  window open)
- the relay's `generation` tracker — unchanged

## Observable shape of a REFUSED verdict transition

`recordProbesOutcome` pushes one `ObservedDiagnostic`:

```ts
{ kind: 'containment_failure', severity: 'error',
  message: 'a later probes frame claimed containment held after an authenticated breach — refused, the breach verdict stands',
  hint: genericHint('containment_failure') }
```

No new `DiagnosticKind` was added (the union is closed and mirrored in `checks/contract.ts`). Find
it by message, not by kind — the genuine breach carries the same kind with the message
`'trusted-vantage containment probes reported a breach'`. After a refused override the run has
**two** `containment_failure` diagnostics; `state.contained` stays `false`.

## Verdict rule as implemented (`observe.ts:249`)

The fence reads `breachAlreadyObserved(state)` (`observe.ts:243`) — the presence of a
`containment_failure` diagnostic, i.e. the permanent record — not `state.contained`.

| current | incoming | result |
| --- | --- | --- |
| `null` | `true` / `false` / malformed | accepted (first observation) |
| `true` | `false` | accepted → `false` + `containment_failure` |
| `true` | malformed | accepted → `null` + `containment_unobserved` |
| `true` | `true` | no-op |
| breach observed | `true` | **refused** — verdict stays `false`, refusal diagnostic pushed |
| breach observed | `false` | no-op (already recorded; no duplicate diagnostic) |
| breach observed | malformed | no-op — a breach is never softened to `containment_unobserved` |

Tri-state preserved exactly: `pushContainmentUnobserved` is still the single minting site,
`finalizeContainmentVerdict` still closes out, malformed still yields `null`, never a substituted
`false`. This also denies the `false → null → true` laundering route.

## Error surface

A refused `whimHostDispatch` call returns **`null`** to the page — the dispatcher's own "no result"
shape, identical to a dropped syscall, and never an error string describing the guard (Playwright
evaluates the delivery expression inside the caller's realm, so it must carry nothing). A legitimate
call still returns the `JSON.stringify(sysret)` string. No `trace` entry of any kind is recorded for
a refused call: `wiring.trace` is unchanged, so "nothing recorded host-side as legitimate" is
assertable as `wiring.trace.length` unchanged / no `syscall` entry for the hand-rolled method.

## Neutering the guard for a red-check (task 2.4)

Flip exactly one expression per channel, run, observe red, then restore:

- `synthrun/observe.ts:491` — `if (source.frame !== page.mainFrame()) {` → `if (false as boolean) {`
- `synthrun/capability.ts:153` — `if (source.frame !== source.page.mainFrame()) return null;` →
  `if (false as boolean) return null;`
- verdict rule, `observe.ts:258` — `if (breachAlreadyObserved(state)) {` → `if (false as boolean) {`

(`as boolean` keeps TypeScript from narrowing the block to dead code.)

Measured pre-fix behaviour with the first two neutered, from inside the opaque-origin realm after
re-minting the relay via `RELAY_REBIND_PROBE` — this is what the red-check should reproduce:

```
relayBefore 'undefined' → relayAfter 'function'      (the re-mint succeeds either way)
contained   true → false        events 5 → 6         diagnostics 0 → 1
whimHostDispatch(...) → '{"whim":"sysret","v":1,"id":99,"ok":true,"result":{}}'
wiring.trace → [{kind:'syscall',method:'storage.kv.set'}]   engine.kv.get('pwned') → 'yes'
```

With the guards in place the same probe yields: `contained` stays `true`, `events` 5 → 5,
`diagnostics` 0 → 0, `hostProvenanceRefusals` 0 → 1, `sysret` `null`, `trace` `[]`,
`engine.kv.get('pwned')` `undefined`.

## Ordering trap (do not reorder)

`page.exposeBinding` (`observe.ts:490`) MUST stay before `page.addInitScript(installRelayShim, …)`
(`observe.ts:536`). Reversed, the shim captures no relay, installs no `ReactNativeWebView`, and the
outer page silently drops every frame — no type error, no fast-gate failure (comment at the site).
