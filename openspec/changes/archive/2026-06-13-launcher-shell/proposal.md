# launcher-shell

## Why

The host is currently a probe screen: a diagnostics bar, hardcoded fixture buttons, and flip-a-
const acceptance harnesses (`App.tsx`). Everything underneath it — contained runtime (#35/#37),
capability bridge (#41), storage engine (#40), version store (#39) — is built and accepted, but
there is no *product*: no way to see your apps, launch one full-screen, leave it, delete it, or
fork it. This change is the product shell (roadmap change #5, lane B), and it carries the
spec's own "prototype early" flag: back navigation is load-bearing and its SDK↔host seam must
be defined by the first proposal to land (#1's contract notes — `sdk-design-system` (#3) is
unproposed, so the seam is defined here).

## What Changes

- **Installed-apps record store** — a persistent host-side store of installed mini-apps
  (id, name, manifest, schema artifact, bundle reference, example flag). Today the only app
  registry is the build-baked `APP_RECORDS` + `BUNDLES` map inside `RUNTIME_HTML`; installed
  apps become host-held records that survive restarts. Design decides MMKV records vs
  version-store-backed (see design.md — the resolution is a thin MMKV index over
  version-store-held bundles).
- **Home grid + full-screen launch** — a launcher screen (app grid, like a phone home screen)
  replacing the probe bar as the default UI; tapping an app launches it full-screen through the
  existing `WebViewHost` machinery. One WebView == one realm == one app (#41 D2): the launcher
  era is a loop over records, not a runtime redesign.
- **Bundle delivery from host-held records** — the outer-page control surface learns to accept
  a bundle *source string* from the host (today it only resolves build-baked names). The
  iframe-side loader contract is untouched: same channel (b) DOM-inserted inline `<script>`,
  same CSP, same realm-reset-per-delivery (spike-2 constraints honored; the iframe-bound
  deliver frame already carries full source).
- **Back navigation as task 1** — Android system back is the primary exit (#42, reversing
  §10's floating-button-primary): back pops the mini-app's own nav stack, then exits to the
  launcher at root. This change defines the SDK-nav↔host **nav-depth seam** (#3 implements the
  SDK half later) and implements the host half, including the guaranteed-exit policy (a buggy
  or hostile app can never trap the user — F4 discipline: nav-depth reports are hints, never
  authority). Plus the demoted **draggable, auto-dimming floating affordance** (host-rendered
  RN overlay → exit to launcher).
- **Delete + fork entry points** — long-press (or equivalent) on a grid tile: delete (with
  confirmation) and fork (new launcher entry backed by the version store's fork verb; product
  verbs only — no git vocabulary anywhere in the UI).
- **First-run seeding** — on first launch, install tip splitter + water counter (existing
  fixtures) as example-labeled, forkable, deletable records, plus a prominent "make your first
  app" CTA (the CTA's destination is #7's prompt screen; here it is a labeled placeholder).

Explicitly **not** changing: CSP, sandbox attributes, module allowlist (locked #35/#37);
transport/dispatcher/gate (#41 — zero edits); invariant suites (§16.4 — runtime-owner
sessions only); `src/runtime/generated/*` / `build/generated/*` by hand.

## Capabilities

### New Capabilities

- `app-launcher`: the product shell — installed-app records (persistence, seeding, example
  labeling), the home grid, full-screen launch/exit lifecycle over one-realm-per-app, delete
  and fork entry points, product-verbs-only surface.
- `mini-app-back-navigation`: the back-navigation contract — system back as primary exit,
  the SDK↔host nav-depth seam (the #3↔#5 coordination contract), the guaranteed-exit
  invariant, and the floating affordance's demoted role.

### Modified Capabilities

*None.* `mini-app-versioning` / `mini-app-forking` are consumed as-is (the launcher calls
their verbs); `sandbox-rendering` / `sandbox-isolation` / `capability-bridge` requirements are
untouched (delivery-by-source is below their requirement level — same iframe contract, same
gate).

## Impact

- **`src/host/`** — new launcher screens + installed-apps store module (new
  `src/host/launcher/`); `WebViewHost.tsx` refactored from probe screen into a reusable
  mini-app host component parameterized by app record + bundle source (probe/diagnostics UI
  survives behind a dev surface — it is the bridge/containment acceptance harness).
- **`App.tsx`** — launcher becomes the default screen; existing probe flips remain.
- **`src/runtime/web/` + `build/assemble.mjs`** — outer-page orchestration accepts
  host-supplied bundle source (`src/runtime/generated/*` regenerate via `npm run build`).
- **`src/host/version-store/`** — consumed, not modified (snapshot/fork/active verbs); seeding
  writes fixture bundles as snapshot #1 so #6 (`version-history-ux`) has history from day one.
- **Build pipeline** — `build/build.mjs` additionally emits fixture bundle sources for the RN
  side (seeding needs the source on-device; today it exists only inside `RUNTIME_HTML`).
- **Dependencies** — none new expected (`react-native-mmkv` already present; navigation between
  the 2–3 host screens uses plain RN state, no nav library — design confirms).
- **Android back handling** — RN `BackHandler` wiring in the host.
- **Downstream contracts** — #3 consumes the nav-depth seam; #6 builds on the record↔store
  mapping; #7 attaches to the CTA; #11's "harness-validated app record" lands into this store.
