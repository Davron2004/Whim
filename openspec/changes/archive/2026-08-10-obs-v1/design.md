## Context

`research.md` is the terrain digest this design stands on; every factual claim below cites it by
section. Three facts fix the shape of the change:

- **The evidence is missing, not hidden.** There is no boundary and no logger (`research.md` §1);
  eight in-scope catch sites drop errors on the floor (§2); the privacy floor lives in doc comments
  (§3). Nothing here is a matter of finding better logs — the records do not exist.
- **This project's build is a release build.** `npm run android:release` is the working recipe
  because the emulator's NAT route to Metro is dead, so `__DEV__` is `false` on the device the
  project actually runs (§8). Anything gated on `__DEV__` alone is dead code on-device — which is
  one of the two reasons Reactotron was rejected (§6).
- **A design fix-loop is running in parallel** on `HomeScreen`, `HistoryScreen`, the four flow
  steps, `Orb`, `app-tile`, `flow-chrome` and `src/sdk/design-tokens.ts`, editing `STYLE` and
  `TYPE_SCALE` only. `obs-v1` owns `FailureScreen.tsx` and `MiniAppView.tsx` outright and must
  touch the rest as little as possible. This is the single strongest constraint on where the error
  boundary goes (D1).

## Goals / Non-Goals

**Goals**

- No screen can fail invisibly: a render throw shows something, logs something, and is recoverable
  without restarting the app.
- One seam every device diagnostic goes through, with channels replacing string prefixes, so a
  reader can filter by subsystem instead of grepping a truncated logcat dump.
- The privacy floor becomes a property of the code (device-side redaction at the seam, `pino`
  `redact` server-side) instead of a comment nobody executes.
- The screen whose job is to explain a failure is rebuilt to the design that explains failures.
- A silent catch cannot be added again without the gate saying so.

**Non-Goals**

- Off-device telemetry, crash reporting, or analytics of any kind (see proposal, Out of scope).
- Editing the launcher screen files the parallel design fix-loop holds.
- Making `generate.ts:97–101` non-fire-and-forget — it gains a log line and stays as it is.
- Widening the `/v1` surface. The log sink is not a `/v1` route and is not device-gated, because it
  is not a product route.

## Decisions

### D1 — The boundary wraps the screen switch, not each screen

`LauncherRoot.tsx` renders a hand-rolled `if/else` chain over `screen.kind` (`:461–570`) into a
single `content` value, which is then wrapped once by `HighlightingProvider` / `SafeAreaView`.
That gives a single seam that dominates every screen the change must cover — `HomeScreen`,
`SettingsScreen`, `HistoryScreen`, `ComposeStep`, `ClarifyStep`, `PlanStep`, `BuildStep`,
`DoneStep`, `FailureScreen` — for one wrap.

**Decision:** a `ScreenBoundary` component wraps `content`, keyed by `screen.kind` so navigating to
a different screen resets the boundary and a screen that failed once is reachable again. Retry
resets in place. `react-error-boundary` v6.1.2 supplies the boundary (§6: pure JS, zero deps, peer
`react ^18||^19`, renderer-agnostic, so bridgeless-safe).

**Rejected:** (a) wrapping each screen component in its own file — nine file edits, seven of which
collide head-on with the parallel design fix-loop, to buy a per-screen fallback nobody asked for;
(b) a boundary above `SafeAreaView` — a failure would then take the status-bar inset and safe-area
frame down with it, which is the blank-screen failure mode this change exists to remove;
(c) `componentDidCatch` hand-rolled — the library is 3 kB of exactly this, and hand-rolling buys
the reset-key semantics we would have to write anyway.

**Consequence:** coverage is a property of the router. A screen added later is covered by
construction, and the spec says so, so nobody re-adds per-screen boundaries later thinking it was
an oversight.

### D2 — `react-native-logs` for the seam; the buffer and both sinks are transports

The seam is `src/host/logging/`, built on `react-native-logs` v5.6.0 (§6: pure JS, zero deps,
active; chosen over hand-rolling and over `loglevel`, which has had no release since 2024-09). Its
transport model is the reason: a ring buffer, the console, and the batching HTTP sink are three
transports over one record stream, rather than three call sites each formatting their own string.

Channels replace prefixes. `whim:gen`, `whim`, `whim:page` (§3) become declared channel constants;
a call site never writes the literal. `logGenError` (`LauncherRoot.tsx:142–149`) and
`logMappedError` (`transport-shared.ts:117–132`) keep their exact field sets — they were already
structured, just stringified at the end — and lose their `console.log`.

**Rejected:** (a) hand-rolling the seam — the fields are the easy part; levels, per-channel
thresholds and multi-transport fan-out are the part that gets written badly under time pressure;
(b) `pino/browser` on the device — §6: a thin console mapper that loses redact-at-serialize, and
its `console.error` path trips RN's redbox, so the logger would create the failure state it exists
to report; (c) one logger object exported as a singleton with no channels — that is what
`console.log('[whim:gen]', …)` already is.

### D3 — Redaction happens at the seam on the device, at the serializer on the server

Two different mechanisms, deliberately, because the constraint differs. On the device there is no
serializer worth trusting — the ring buffer holds objects the overlay reads directly — so
redaction has to happen **before** the record is buffered, or the overlay and the sink can disagree
about what is sensitive. On the server, `pino`'s `redact` operates at serialize time for every
child logger, which is strictly stronger than a per-call-site rule and is the reason `pino` is
worth a new dependency at all (§6).

**Decision:** device-side, the seam replaces the value of any sensitive-named field with a fixed
marker before buffering. Server-side, one `pino` root logger carries the `redact` paths and every
child inherits them. `server/src/dev-log.ts` is deleted rather than wrapped — a wrapper would leave
two ways to log.

**Consequence:** the rule in the current doc comments ("NEVER pass prompt/body text, the
`x-whim-device` value, or the API key here") stops being an instruction to a future author and
becomes a test.

### D4 — `adb reverse` is the sink transport, and the "dead Metro NAT" note does not apply

This contradicts a note repeated in several places in this repo, so it is stated flatly:
**`adb reverse tcp:<port> tcp:<port>` works from a release APK.** The precedent is
`openspec/changes/archive/2026-08-01-fix-generate-stream-transport/progress.md:128` — chain-7's
attended on-device verification ran a real OpenRouter generation from a release APK on
`emulator-5554` over `adb reverse tcp:8787`, logging `POST /v1/generate 200 155815ms` (§7).

The "emulator's NAT route to Metro is dead" note (CLAUDE.md; `docs/decisions.md:441`) is about
**Metro's own dev-server protocol**, not about TCP port forwarding. `docs/decisions.md:441` itself
says "also retry `adb reverse` for plain HTTP — the Metro failure may have been dev-server-specific";
§7 is that retry, and it passed. A task in this change records the correction in `docs/decisions.md`
so the next reader does not re-derive it.

**Consequence:** sink B needs no new address and no new setting. It posts to the same server
address the device already persists for `/v1/generate`, on a different path.

### D5 — Sink B and the overlay are flag-gated, not `__DEV__`-gated

`__DEV__` is `false` in this project's builds (§8), and the existing on-device acceptance probes
already solved this with build-time boolean flags defaulting to `false` (`RUN_VSTORE_PROBE`,
`RUN_STORAGE_PROBE`, `RUN_BRIDGE_PROBE`).

**Decision:** the overlay's gate is `__DEV__ || <explicit flag>`; the sink's gate is the explicit
flag alone (a network transport should not switch itself on because someone ran Metro). Both flags
default to `false`, so a shipping build has neither. The `app-launcher` delta writes this down as a
rule about *every* developer diagnostics surface, because `__DEV__`-only gating is a silent
no-op here and would otherwise be re-introduced as if it were the safe choice.

**Trade-off, stated:** an explicit flag is one more thing that can be left on. The mitigation is
that it defaults to `false` and the spec's shipping-build scenario is a test, not a review note.

### D6 — The log envelope is a type-only contract module

`zod` must not enter the Metro graph; every existing device-side `@whim/contract` import is
`import type` with an explicit comment saying so (§8). A zod schema for the log envelope would be a
value in the contract package that a device-side author could reach for by reflex.

**Decision:** `contract/src/dev-log.ts` declares the record and batch types and the sink route's
path, and exports **no runtime value**. The server validates incoming batches with a hand-written
structural guard on its own side. This is a genuine departure from `generation-contract`'s
"schemas SHALL be zod values" rule, so the delta modifies that requirement to name the exception,
bound it to this one module, and forbid extending it — rather than leaving a contradiction for a
reviewer to find.

**Rejected:** (a) a zod schema in `contract/` used only by the server — smallest code, but it puts
a tempting runtime value in the package the device imports from, and the discipline that keeps
`zod` out of Metro is a convention held by comments; (b) duplicating the interface in
`src/host/logging/` and `server/src/` — two sources of truth for a wire shape, which is the exact
failure the contract package exists to prevent; (c) no shared shape at all — then the tail script
and the overlay drift.

### D7 — The failure screen renders design `3b` from data it already has

Design `3b` (`whim-design-handoff/reference/Whim Mobile.dc.html:306–333`) is a six-state demo
ladder covering the whole build-and-repair lifecycle. Only its terminal state (`RP[5]`,
html:940) is a failure screen; the others are build-progress states that belong to the build step
and are **not** in this change.

**Decision:** rebuild `FailureScreen.tsx` to the `3b` terminal-state geometry — 26px title with a
dynamic colour, sub-line, attempt-progress row (`rpShowAttempts`/`rpAttempts`, html:309–316),
bordered large-radius panel of checklist rows with ring/mark icons (`rpRows`, html:318–324) — with
every value resolved from the v2 tokens. The screen currently imports **no** design tokens
(§5); that is the defect being fixed, not a style preference.

Three rows, matching `RP[5]`: a `done` row saying the last working version is untouched, a `bad`
row per diagnostic `hint`, and a muted `wait` row saying what usually gets past this. All text is a
`hint` or a `copy.ts` string, so the hint-only invariant is preserved by construction.

**Attempt count comes from the device's own observation of the stream** — the number of `repair`
stage transitions it saw — not from a new wire field. When it saw none (a transport error before
any stage), the row is hidden rather than showing "Try 1 of 3" for a run that never tried. This
keeps `generation-contract` and the ratified `stage` enum untouched.

**Rejected:** (a) adding an attempt count to the wire — a schema change to display a number the
device already watched go past; (b) rendering the other five `3b` states — they are build-step
states, and building them here would collide with the design fix-loop's `BuildStep.tsx`.

### D8 — The lint rule and the deps land in one human-ratified batch, and the pre-existing sites are remediated in it

This is the awkward part of the change and is written out rather than discovered at merge time.

`package.json`, `package-lock.json`, `server/package.json`, `knip.json` and `.eslintrc.js` are all
protected (§8; `protect-harness.sh:109–112` — Class 1, so grantable in a worktree but blocked for a
subagent without a grant). The owner's call is one HUMAN-BOOTSTRAP chain with a **single** batched
ratification, landing first, because every other chain needs the dependencies to exist.

But the tripwire goes red the moment it lands: eight in-scope catch sites violate it (§2), and they
cannot be fixed before the seam they are supposed to log through exists. `scripts/gate.sh` runs
lint on every attempt, so a red tripwire would fail every subsequent chain's self-gate.

**Decision:** the bootstrap patch carries the protected edits **and** an interim marker on each of
the eight sites — an inline `eslint-disable-next-line` comment carrying a fixed, greppable token
naming this change. Those eight files are ordinary source, so the marker is applied in the same
prepared patch and removed by an agent later. The migration chain replaces every marker with a real
seam call, and its suite asserts **zero** markers remain anywhere in the repo. The gate is green at
every commit, there is one ratification, and the interim state is self-deleting and testable.

**Rejected:** (a) two HUMAN-BOOTSTRAP chains, deps first and the lint rule last — clean ordering,
but the owner explicitly does not want per-file Class-2 drip, and the second ratification is exactly
that; (b) landing the rule as `warn` and promoting it later — a second protected edit wearing a
disguise, and a warning in this repo's gate is a no-op; (c) an `overrides` block in `.eslintrc.js`
scoping the rule off for the legacy files — removing it later is another protected edit, and an
allowlist inside protected config is invisible to the agents who must shrink it.

**Trade-off, stated:** the human's prepared patch is larger than four dependency lines. It is
mechanical (eight one-line comments) and the removal is enforced by a test, which is the cheapest
honest resolution available under "one ratification, deps first".

### D9 — The tripwire selector matches catch clauses only, and says so

The rule is the core `no-restricted-syntax` with an esquery selector, matching the existing
`.sort()`-without-comparator precedent in `.eslintrc.js` exactly (§4) — no new plugin, no new
dependency, legacy `.eslintrc.js`, eslint 8.57.1.

The selector matches a `CatchClause` whose block contains neither a `ThrowStatement` nor a call
into the logging seam. Two limits are accepted and written into the spec rather than papered over:

- **`.catch(fn)` is not a `CatchClause`.** `generate.ts:97–101` is therefore outside the rule; it
  gets a log line by hand and stays fire-and-forget.
- **`:has()` matches descendants**, so a throw inside a nested callback inside a catch block
  satisfies the rule. That is a false negative, not a false positive; a rule that fires wrongly
  gets disabled repo-wide within a week, and this one must survive.

`src/runtime/web/`'s 13 silent catches are out of lint scope by `.eslintignore` (§4) — they are
browser-context strings inlined into the WebView that deliberately swallow. Nothing about them
changes.

### D10 — Every new suite joins an existing runner

`package.json` is protected, so no agent adds an npm script. Launcher-side suites register into
`src/host/launcher/test/acceptance.ts` (`npm run launcher:test`); server-side suites join
`server/test/run.mjs` (`npm run server:test`). The one new script — `whim:logs` — is in the
bootstrap patch, applied by the human, and is a tail utility rather than a suite.

The registry file is a single shared file, so the three chains that add a registration line are
serialized in `chains.md` (the same treatment `shell-redesign-v2` gave it).

## Risks / Trade-offs

- **The tripwire lands red without D8's interim markers** → the bootstrap patch carries them and the
  migration chain's suite asserts zero remain. If a marker survives to closure, the assertion fails
  the gate, not the review.
- **New device dependencies change what Metro resolves** → `npm run guard:metro` bundles for real
  and asserts exit 0 plus a size floor; it is a bootstrap-chain task and runs again in `gate-full`.
  Both new device deps are pure JS with zero transitive dependencies (§6), which is why they were
  chosen over the alternatives.
- **`knip` may not see `pino-pretty`** — it is reached as a transport target, not an import → add it
  to `ignoreDependencies` in the same bootstrap patch; add the others only if `knip` actually flags
  them, so the ignore list does not grow speculatively.
- **The overlay and the sink are one flag away from a shipping build** (D5) → both default to
  `false`, and the `app-launcher` shipping-build scenario is a test.
- **The batching sink runs on the same device as an in-flight SSE generation** → it is off by
  default, bounded by count and interval, drops rather than grows, and its failures are recorded
  without recursing. A sink that can slow down generation would be worse than no sink.
- **`FailureScreen`'s props grow** (attempt count, whether a working version exists) → the shell
  wiring chain supplies them from what it already tracks; the contract is declared in
  `handoff/failure-screen.md` so the two chains do not negotiate at merge time.
- **`copy.ts` is a shared launcher file** the parallel design fix-loop is not listed as touching,
  but which lives next to files it is → the failure-screen chain adds keys and edits none, so a
  merge conflict there is additive and resolvable. Called out in `chains.md`.

## Migration Plan

None. Nothing is persisted by this change, no stored shape changes, and no wire schema changes.

- The ring buffer is in memory and empty at launch.
- The sink and the overlay are off unless a flag is set.
- The server's log file is created on first append and is untracked; deleting it is the rollback.
- Rolling the change back is removing four dependencies and one lint rule; no data is left behind.

## Open Questions

- **Ring buffer capacity.** Sized to comfortably outlive one generation run's breadcrumbs while
  staying trivially bounded; the number is a constant in one place, and the on-device chain is where
  it gets confirmed or changed.
- **Whether the checklist's `done` reassurance row can always be truthful.** It claims the last
  working version is untouched, which holds when the target app has a prior snapshot. For a
  first-ever generation there is none; the row is omitted rather than reworded. Confirmed on device.
- **Whether `pino-pretty` earns its place** once the tail script exists — the script could
  pretty-print itself. Kept for now because `npm run server:dev` reads better with it and it is a
  dev dependency only.
