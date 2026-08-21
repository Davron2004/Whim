## Context

`research.md` (the waiting-state census) enumerates every ill-behaved wait in the launcher,
file:line, across three buckets: server-API waits (A1-A6), silent waits (B1-B7), and non-network
waits (D2-D5). Generation itself (A3, `LauncherRoot.tsx:601-609`) is the one reference-quality
wait: a real `AbortController`, hardware-back cancels it, "Leave it running" detaches
deliberately, and every post-await state write is guarded (`s.kind === 'build'`). Everything else
in this change either lacks that guard (B1, a real bug — research.md "navigation hijack"), lacks
cancellation at all (A2/B2), lacks any visual state (B3-B5, B7, D5), or lacks re-entrancy
protection (B6, also a bug). This design applies the A3 pattern everywhere else it's missing,
plus adds transport-level timeout classification (A5/A6) that A3 doesn't need because A3's own
`fetch`/XHR open is already covered by the same defect and gets fixed here too, since generate
shares the same transport module (`generation-client.ts`, `xhr-transport.ts`) as clarify/rewrite.

## Goals / Non-Goals

**Goals:**
- Every non-generation server call the launcher makes (clarify, rewrite, and — as a side effect
  of fixing the shared transport module — generate's own stream open) is cancellable and its
  post-await state application is screen-guarded, matching A3.
- Every silent wait (B3-B5, B7, D5) gets a visible state appropriate to its length and kind: busy
  affordances for git/store ops (B3, B4, B6), a skeleton only where content is truly loading (B5,
  matching the D1 precedent), a boot chrome for the WebView realm (B7), and a subtle pending
  indicator for an in-sheet computed value (D5).
- B1 and B6 are fixed as bugs, not just "improved": B1 (navigation hijack) can no longer force
  the user back into the flow from Home; B6 (double-submit) can no longer queue two restores or
  two forks from one confirm sheet.

**Non-Goals:**
- Build-screen activity signals/journal — that's `generation-observability`, a separate change;
  this change does not add a generic spinner or progress detail for LLM-length waits.
- Server connectivity probing (pre-flight "is the server up" checks) — that's
  `server-connectivity`, a separate change.
- Ghost tiles (an install-affordance concept, in flight as `launcher-ghost-tiles`) — this change
  is explicitly sequenced after it lands to avoid `LauncherRoot.tsx` merge conflicts (research.md
  "Risks / unknowns").
- No overall stream-duration timeout is added for `/v1/generate` — long streams are legitimate
  (research.md A5/A6); only the connect/first-event window is bounded.

## Decisions

### D1: Cancellability + screen-guard is the one pattern, applied uniformly

A3's pattern is: (1) an `AbortController` stored where a leave-handler can reach it, (2) the
leave-handler (hardware back / navigate-away) sets a `cancelled` flag and calls `.abort()`, (3)
every `setScreen` after an `await` first checks the screen is still the one that started the
call. This change applies the identical three-part pattern to `onComposeContinue` (clarify, A1/B1)
and `openPlan` (rewrite, A2/B2) rather than inventing a second cancellation idiom. Rationale:
consistency lets one mental model cover the whole flow, and the guard is the actual bug fix for
B1 — without it, aborting the fetch alone doesn't stop a `.then` that already resolved before the
abort landed from writing into the wrong screen.

Alternative considered: a single flow-wide `AbortController` shared across compose→clarify→plan
instead of one per step. Rejected — each step's request is independently cancelable by leaving
that step specifically (e.g. going back from plan to clarify should not need to have aborted
clarify, which already completed), and per-step controllers is exactly what A3 already does for
generate relative to the steps before it.

### D2: Transport timeout is connect/first-event only, not stream-duration

The census (A5/A6) is explicit that a hung *connect* reads as slow progress rather than network
failure, but a long-running legitimate generation must not be killed by a duration cap. The
timeout therefore wraps only the time from request start to the first byte/event observed on the
stream (~15s), not the stream's total lifetime. On the `fetch` path this is a `setTimeout` racing
the initial `fetchImpl` call (aborting via the same `AbortController` used for user-cancel, so the
existing abort-vs-error classification in `openFetchGenerateStream` handles it uniformly). On the
XHR path this is `xhr.timeout` set to the same value before `.send()` — the `ontimeout` handler at
`xhr-transport.ts:267` already exists and already exists to classify a timeout as `network`; it
has simply never been armed. Once the first event/chunk arrives, both paths disarm the timeout so
subsequent stage/token events are unbounded.

Alternative considered: reuse the existing `AbortSignal` timeout helpers, if any, generically for
the whole request duration. Rejected per the explicit non-goal in the task decisions — an overall
duration timeout would kill legitimate long-running generations.

### D3: Busy states are per-affordance, not a global overlay

B3 (open), B4 (fork/delete), B6 (restore/copy) each get a *local* busy/disabled state on the
triggering control (tile press state, sheet-row disablement, confirm-button disablement) rather
than a global modal spinner. Rationale: these are all short (snapshot read, single git op)
compared to generation, so a full-screen takeover is disproportionate; the fix is "the tap
registered and is working," not "wait here." This mirrors A3's Plan step precedent, whose own
primary action stays busy under its row skeleton until the response lands
(`LauncherRoot.tsx:455-456` comment) rather than blocking the whole screen.

### D4: B5 (history first load) is the one legitimate skeleton in this change

Per the D1 (`LauncherRoot.tsx:353-364`/`HomeGridSkeleton`) precedent already established as
correct: a skeleton is appropriate exactly when the wait is a true content load with a known
eventual shape (a list of history rows), not a proxy for an LLM-length wait. `HistoryScreen`'s
`snapshots` state starts `[]` and is indistinguishable from a truly-empty history — the fix adds
an explicit `loading` boolean so the empty-vs-loading distinction is real, and renders row
skeletons (reusing the same skeleton-geometry primitives the design system already exports) while
`loading` is true.

### D5: B7 boot state lives in `app-launcher`, not `sandbox-rendering`

Placement pick (asked for explicitly): the boot-state requirement is added to `app-launcher`, not
`sandbox-rendering` or `mini-app-back-navigation`. `app-launcher` already owns the host-side
mini-app container chrome — see its existing requirements "The home grid launches apps
full-screen, one realm at a time" and "The mini-app container styles its failure state from
tokens" (`openspec/specs/app-launcher/spec.md`), which govern exactly the `MiniAppView.tsx`
component this defect lives in. `sandbox-rendering` governs the bundle's own React-to-DOM
rendering *inside* the WebView, which is a different, iframe-side concern; the boot state is
strictly a host-side "what does the launcher show before the realm has anything to show"
concern, so it belongs alongside the container's existing failure-state requirement.

The boot state uses `HostState`'s existing `lastError`/`launchFailed` signals (already plumbed for
the failure branch `MiniAppView.tsx:63-74`) plus a new "has painted" signal derived from the
existing `paintMs` field (`useMiniAppHost.ts:44`, currently wired only to `DevProbeScreen`) —
`paintMs != null` means first paint has been observed. No new bridge message is needed; this is a
product-path consumer of a signal that already exists dev-probe-only.

### D6: D5 (restore-diff pop-in) gets a pending indicator, not a skeleton

The fields-leaving-view line (`HistoryScreen.tsx:151-164`) is a single reassurance sentence, not a
list with a known row shape — a skeleton would be disproportionate scaffolding for one line. It
gets a subtle pending state (e.g. a muted placeholder or dimmed treatment) that resolves in place
once `fieldsLeavingViewOnRestore` settles, consistent with the existing `cancelled` guard already
present in that effect.

## Risks / Trade-offs

- [Adding an `AbortSignal` parameter to `clarifyPrompt`/`rewritePrompt` changes their public
  signature] → Both are internal to `src/host/launcher/`, called from exactly one call site each
  in `LauncherRoot.tsx`; the parameter is additive-optional, so no other caller breaks.
- [A ~15s connect timeout could false-positive on a genuinely slow-but-alive server] → Scoped to
  connect/first-event only, matching the census's own framing of the defect as "hung connect,"
  not first-token latency; the value is a starting point, tunable without a spec change since
  the exact duration isn't a normative contract detail.
- [`paintMs`-based "has painted" reuses a dev-probe-only signal in a new product-path consumer] →
  The signal itself (`mountToFirstPaintMs` from the realm) is already part of the trusted
  postMessage contract (`useMiniAppHost.ts:221`); this only adds a second reader, not a new
  producer, so it doesn't touch the nonce-auth trust boundary (spike2 F4).
- [Sequencing after `launcher-ghost-tiles`] → If ghost-tiles lands with materially different
  `onOpen`/`onFork`/`onDelete` shapes than assumed here, this change's chains re-diff against the
  merged file at dispatch time rather than against this design's line numbers, which are current
  as of `research.md`'s compilation and may drift.

## Migration Plan

No data migration. This is a UI/control-flow change to existing screens; no persisted schema,
storage-engine, or wire-contract change. Land as ordinary `whim-harness` chains after
`launcher-ghost-tiles` merges to `main`; no feature flag needed since every change is either a bug
fix (B1, B6) or an additive visual state that degrades gracefully (busy/skeleton/boot states are
pure rendering, not behavior-gating).

## Open Questions

None outstanding — every decision in the task's scope list has a corresponding `## Decisions`
entry above. If an implementer hits a case research.md doesn't cover (e.g. a second call site for
`clarifyPrompt`/`rewritePrompt` this design didn't anticipate), that's a gap to report, not a
license to invent a new pattern.
