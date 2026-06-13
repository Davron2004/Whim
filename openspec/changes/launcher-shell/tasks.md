# launcher-shell — tasks

*(§16.5 discipline: group 1 writes the test specs in English before any implementation.
Group 2 is the brief's "back navigation as task 1" — the spec's prototype-early flag.
Invariant-suite changes are out of scope for every task below (§16.4); the expectation is
zero invariant edits — if one turns out to be needed, stop and hand it to a runtime-owner
session.)*

## 1. English test specs (before implementation — §16.5)

- [x] 1.1 Write the back-policy test spec in English: every state transition of the
      back-press / nav-depth / timeout machine — depth-0 exit, pop-forwarding, the
      unhandled-press window, double-back escape, inflated-depth claims, stale-generation
      reports ignored, fresh realm resets to depth 0.
      → `src/host/launcher/test/back-policy.spec.md`
- [x] 1.2 Write the installed-apps store test spec in English: index CRUD + ordering +
      restart survival; seed idempotence + deleted-examples-stay-deleted; fork mapping
      (new entry, shared repo, correct lineage on every access, own engine appId); delete
      refcounting (last-reference removes repo keys; sibling fork survives); store
      `remove(appId)` leaves zero keys; no git vocabulary in any return shape.
      → `src/host/launcher/test/installed-apps.spec.md`
- [x] 1.3 Write the on-device acceptance script in English (the Done-when walk): fresh
      install → seeded grid → launch water-counter from its record (by source, not baked
      name) → syscalls live, data persists → system back exits → fork → fork runs with its
      own data → delete original, fork survives → delete fork → no residue (index, store
      keys, SQLite db) → containment 42/42 throughout.
      → `src/host/launcher/test/acceptance.spec.md`

## 2. Back navigation (the #3↔#5 seam — design D4/D5)

- [x] 2.1 Define the `nav-depth` / `nav-back` control-family frames: vocabulary in the
      runtime page parts (`src/runtime/web/`) and `classifyFrame` in
      `src/host/bridge/contract.ts`, with generation stamping per #41 D3 fencing. Document
      the seam contract where #3 will find it (the SDK half's TODO anchor).
- [x] 2.2 TDD `src/host/launcher/back-policy.ts` — the pure state machine from 1.1's spec
      (inputs: back-press / nav-depth / timeout; outputs: exit | forward | ignore) — tests
      green under Node.
- [x] 2.3 Wire Android `BackHandler` in the mini-app host: depth hints tracked from
      authenticated-relay frames (hint, never authority), pop requests forwarded via the
      outer-page control surface, exit on policy verdict.
- [x] 2.4 Build the floating affordance (host-layer RN overlay): drag + edge snap,
      auto-dim after idle, restore on touch, tap exits to launcher.

## 3. Bundle delivery from host-held records (design D3)

- [x] 3.1 Extend the outer-page orchestration (`src/runtime/web/` + `build/assemble.mjs`)
      with `bundleSource` delivery: same reset-then-deliver path, same iframe-bound frame;
      JSON-escape helper + size guard on the host side. Regenerate via `npm run build`
      (never hand-edit `src/runtime/generated/*`).
- [x] 3.2 `npm run build && npm run invariants` green — 42/42, and the diff shows zero
      changes to CSP, sandbox attributes, or the module allowlist (review rule).
- [x] 3.3 Host-side `deliverBySource` in the mini-app host hook; desktop-verify a fixture
      delivered by source behaves identically to its baked twin (render + syscall + verdict).

## 4. Version-store additive verb (design D2)

- [x] 4.1 Add `remove(appId)` to the version-store public API (additive; product verb):
      KvBackedFs/MemoryFs prefix delete, `vstore:test` coverage incl. zero-keys-after and
      no-git-leak on the surface.

## 5. Installed-apps store (design D1/D2/D7)

- [x] 5.1 TDD `src/host/launcher/app-index.ts` from 1.2's spec: MMKV-backed records
      (`InstalledApp` shape per design) + ordered list, behind a mockable KV seam.
- [x] 5.2 TDD `src/host/launcher/store-access.ts`: the only sanctioned VersionStore path —
      lineage check-and-switch per entry, fork (store fork → new entry with `storeId` +
      `lineageId` + provenance), delete with repo refcount + `remove`, active-bundle read.
- [x] 5.3 Emit `src/runtime/generated/app-bundles.ts` from `build/build.mjs` (fixture
      name → IIFE source) and implement first-run seeding: snapshot fixtures into the store,
      write example-labeled index entries, idempotence marker per 1.2's spec.
- [x] 5.4 Add `npm run launcher:test` running groups 2.2/5.1/5.2's Node suites; wire it into
      CI alongside the existing blocking suites.

## 6. Launcher UI (test-after — §16.1)

- [x] 6.1 Refactor `WebViewHost.tsx`: extract the realm loop into `useMiniAppHost(record,
      bundleSource)` + `MiniAppView`; rebuild the probe surface as `DevProbeScreen` over the
      same hook (baked fixture set, verdict bar, syscall counters) — probe parity verified
      against the current screen, realm+dispatcher always bound (the cap-intruder lesson).
- [x] 6.2 Build `HomeScreen`: tile grid from the index (monogram + deterministic color,
      example badge), "make your first app" CTA placeholder, long-press action sheet —
      Open / Fork / Delete-with-confirmation. Every string passes the product-verbs guard.
- [x] 6.3 Build `LauncherRoot` (plain-state screen switch: home / mini-app / dev probe via
      `__DEV__` entry) and make it the `App.tsx` default; existing probe flips untouched.
- [x] 6.4 Close the fork and delete flows end-to-end: fork launches with its own engine
      appId and fresh user data; delete removes index entry + user-data db + (last
      reference) store keys.

## 7. Acceptance & bookkeeping

- [x] 7.1 Desktop gates green: `npm run build`, `npm run invariants`, `npm run lint`,
      `npm run vstore:test`, `npm run storage:test`, `npm run bridge:test`,
      `npm run launcher:test`.
- [ ] 7.2 On-device acceptance per 1.3's script (offline release APK, logcat
      `ReactNativeJS`, real taps); record observed behavior + any latency notes.
      → **PENDING: requires a physical device/emulator run** — `npm run android:release`,
        then walk `src/host/launcher/test/acceptance.spec.md`. Everything else is prepared.
- [x] 7.3 Bookkeeping: decisions.md entry (as-built, per #39/#40/#41 convention), DEVLOG
      capture, roadmap ledger `Status` update for #5, and confirm the seam-contract notes
      #3 consumes are accurate as-built.
      → decisions.md #43, DEVLOG `launcher-shell` section, roadmap #5 Status + Contract notes.
