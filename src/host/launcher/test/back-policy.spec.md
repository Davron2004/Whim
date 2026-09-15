# Back-policy test spec (task 1.1 — §16.5 English-first)

The pure state machine `src/host/launcher/back-policy.ts` decides what a system-back press
does for a running mini-app. It is the host-owned half of the nav-depth seam (design D4) and
the home of the **guaranteed-exit invariant**: no app, however buggy or hostile, can trap the
user. The machine is pure — no timers, no I/O. The host owns the wall clock and feeds it
events; the machine only reduces state and emits an action.

## Vocabulary

- **Events (inputs):**
  - `reset(generation)` — a fresh realm was bound at `generation` (launch or relaunch).
  - `navDepth(depth, generation)` — an SDK nav-depth hint arrived. **Untrusted** (F4): the
    bundle shares the iframe scope and can forge or inflate it.
  - `backPress(overlayOpen?)` — the user pressed Android system back. `overlayOpen` (store-launch-
    compliance chain-5, mini-app-back-navigation delta) reports whether a host-layer sheet (the
    report sheet) currently covers the realm.
  - `timeout()` — the host's unhandled-press window (the 400 ms constant, host-side) elapsed
    with no depth decrease since the last forwarded pop.
- **Action (output of `backPress`):** `exit` | `forward` | `ignore` | `close-overlay`.
  - `exit` → tear the realm down, return to the launcher.
  - `forward` → post a `nav-back` request into the realm (the SDK pops its stack).
  - `ignore` → do nothing (no realm bound).
  - `close-overlay` → close the host sheet; neither forwarded nor counted (`overlayOpen` was set).
- **State:** `{ generation, depth, awaitingPop, escapeArmed, bound }`.

## Behaviors to assert

### Depth-0 exit (apps without nav — every app in this change)
1. After `reset(g)` with no nav-depth ever reported, `backPress()` → `exit`.
2. After a `navDepth(0, g)`, `backPress()` → `exit`.

### Pop-forwarding (the cooperating app)
3. `reset(g)`, `navDepth(2, g)`, `backPress()` → `forward` (and `awaitingPop` is set).
4. Cooperating pop: while awaiting, `navDepth(1, g)` (a decrease) clears `awaitingPop`; the
   next `backPress()` → `forward` again; after `navDepth(0, g)` the next `backPress()` → `exit`.
   (The spec scenario: depth 2, three presses → forward, forward, exit.)

### The unhandled-press window + double-back escape (the misbehaving app)
5. `navDepth(5, g)`, `backPress()` → `forward`; with **no** depth decrease, a second
   `backPress()` → `exit` (the natural double-tap reflex — exits even inside the window).
6. `navDepth(5, g)`, `backPress()` → `forward`; then `timeout()` arms the escape; the next
   `backPress()` → `exit` (the patient user — the window elapsed, the press is unhandled).
7. Inflated-depth claim: `navDepth(999999, g)` then repeated presses still resolve to `exit`
   within one unhandled-press window — the magnitude buys the app nothing beyond a single
   forwarded pop.

### Slow-but-cooperative app (the escape must not punish cooperation)
8. `navDepth(2, g)`, `backPress()` → `forward`, `timeout()` arms escape, THEN a genuine
   decrease `navDepth(1, g)` arrives → the escape is disarmed and `awaitingPop` cleared; the
   next `backPress()` → `forward` (the app proved it handles pops; we do not exit out from
   under it).

### Generation fencing (#41 D3, mirrored)
9. A stale-generation report is ignored: after `reset(g2)`, a `navDepth(7, g1)` leaves the
   machine at depth 0; `backPress()` → `exit` (a fresh realm starts at depth 0).
10. A report whose generation does not equal the current generation never mutates depth or the
    pop/escape flags.

### Fresh realm resets to depth 0
11. `navDepth(4, g1)`, then `reset(g2)` → depth, `awaitingPop`, `escapeArmed` all clear;
    `backPress()` → `exit`.

### No realm bound
12. Before any `reset`, `backPress()` → `ignore` (the launcher's own back handling owns this
    case — the policy does not claim a press when no app is running).

### A host sheet takes back first (store-launch-compliance chain-5)
13. `backPress(overlayOpen: true)` → `close-overlay`, unconditionally — regardless of depth or
    whether a realm is even bound — and mutates nothing (`awaitingPop`/`escapeArmed`/`depth` all
    unchanged). Once the sheet closes (`overlayOpen` no longer set), the very same press the sheet
    intercepted still resolves exactly as it would have with no sheet ever opened.

## Why pure / why these edges

The escape is the safety property, so its tests are adversarial: an app that never decreases
depth (5, 6, 7), an app that lies about magnitude (7), and an app that is merely slow (8 — the
one case where the escape must *yield*). Generation fencing (9–11) is the same stale-frame
discipline the bridge already enforces, applied to an unauthenticated hint.
