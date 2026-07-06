# launcher-shell — design

## Context

Everything below the product surface is built and accepted: contained runtime (#35/#37),
capability bridge with storage as syscall #1 (#41), per-app SQLite engine (#40), on-device
version store with product verbs (#39). The host above it is a probe screen: `App.tsx` flips
between acceptance harnesses and `WebViewHost`, which renders a diagnostics bar plus hardcoded
fixture buttons over one full-screen WebView.

Current realities this design builds on (verified against code, per protocol rule 2):

- **Bundle delivery is name-keyed against a build-baked map.** `build/assemble.mjs` bakes a
  `BUNDLES` (name → IIFE source) map into the outer page of `RUNTIME_HTML`;
  `__whimControl.reinject({reset, bundle: name, generation})` looks the source up and posts it
  into the iframe as `{__whimDeliver:true, bundle: src}`. The iframe-bound frame *already
  carries full source* — only the outer page's name lookup is baked-set-bound.
- **App records are build-extracted.** `src/runtime/generated/app-records.ts` holds the
  host-held manifest + schema artifact per fixture (#41 D4: host-held, never the bundle's
  self-description), keyed by fixture name.
- **The version store** (`src/host/version-store/`) speaks product verbs. Relevant semantics:
  `fork(appId, snapId)` creates a lineage *and switches the repo's active lineage to it*;
  `history`/`active` read the active lineage; `switchLineage` switches; there is **no
  delete/remove verb** on the surface today. Persistent backend: `KvBackedFs` over MMKV.
- **One WebView == one realm == one app** (#41 D2). `WebViewHost.deliverApp` already does the
  full launch loop: tear down old realm, bind realm + dispatcher at a new generation
  (always — the cap-intruder lesson), reset the iframe, deliver.
- **#42 locked:** system back is the primary exit; the floating affordance is demoted to a
  draggable, auto-dimming "home" extra. **#1's contract notes:** SDK navigation does not exist
  yet (built in #3); the first proposal to land defines the nav-depth seam — that is this one.

Constraints inherited unchanged: never widen CSP/sandbox/allowlist (#35/#37); spike-2's five
load-bearing constraints; F4 (trust no bundle self-report); capability additions are
row+stub only (#41) — not exercised here, no new capabilities; product verbs only on
user-facing surfaces (build guard); §16.4 — invariants are authored in runtime-owner sessions.

## Goals / Non-Goals

**Goals:**

1. A persistent installed-apps record store the launcher, and later #6/#7/#11, read and write.
2. Home grid → full-screen launch → system-back exit, on-device, over the existing realm loop.
3. The nav-depth seam defined (the #3↔#5 contract) and its host half implemented, with a
   guaranteed-exit policy that holds against a buggy or hostile app.
4. Delete + fork entry points over store verbs; first-run seeding (tip splitter + water
   counter as labeled examples) + "make your first app" CTA placeholder.
5. Bundle delivery from host-held records without touching the iframe-side contract.

**Non-Goals:**

- Prompt screen / generation flow (#7), history UX (#6), any server interaction (#8+).
- SDK `useNavigation`/`useRoute` (#3 — this change ships the host half + the contract).
- App icons/theming beyond a derived tile (monogram + deterministic color); SDK work is #3.
- Invariant-suite changes (none required — see Risks; any that emerge are a runtime-owner
  session's work).
- Multi-window / split realms; background execution.

## Decisions

### D1. Record store = a thin MMKV index; bundles live in the version store

The brief left "MMKV record vs version-store-backed" to design. Resolution: **both, with a
sharp split** — MMKV holds the *index* (small, synchronous, list-shaped: what the home grid
needs); the version store holds the *artifacts* (bundle source + prompt, snapshot-tagged: what
rollback/fork/history need).

- A new `src/host/launcher/app-index.ts` over `react-native-mmkv` (already a dependency):
  one MMKV instance (`whim.launcher`), one record per installed app + one ordered id list.
- Record shape (the launcher-facing contract; zod-free for now, typed in TS):

  ```ts
  interface InstalledApp {
    id: string;            // launcher id == store appId (D2)
    name: string;          // display name (product surface)
    example?: boolean;     // seeded example label (first-run apps)
    createdAt: number;     // epoch ms
    record: AppRecord;     // #41's host-held manifest + schemaArtifact — verbatim
    lineageId: string;     // version-store lineage this entry tracks (D2; 'main' default)
    forkedFrom?: { id: string; name: string };  // provenance for the tile/UI only
  }
  ```

- The bundle source is **not** in MMKV: launching reads `store.active(id)` (the active
  snapshot's `bundle.js`). Every install/seed/fork writes the store first, the index second
  (the store is the source of truth; the index is rebuildable in principle).

**Why not MMKV-only (bundle in the record)?** "Every generation is a tagged snapshot with
rollback/pin/fork" is a v1 invariant (§11); #6 builds directly on per-app store history. An
MMKV-held bundle would make #5 simpler and #6 a migration. **Why not version-store-only?**
The grid needs a fast synchronous list at launcher mount; the store is async, git-backed, and
per-app — deriving "all installed apps + names + flags" from it on every home render is the
wrong shape. (#41 already anticipates the app record becoming "harness-validated and
version-store-tracked" — that lands with #11 writing through this same seam.)

### D2. One launcher entry == one store appId; fork = store fork + a new entry on a new lineage

`fork(appId, snapId)` creates a lineage *in the same repo* and switches the repo's HEAD to it.
Mapping forks onto launcher entries:

- Launcher **fork** of app `A`: call `store.fork(A.id, activeSnapshotId)` → `lineageId`;
  create a new index entry `{ id: A.id-fork-n…, … }` — **no.** The new entry shares the repo,
  so its `id` cannot double as the store key. Resolution: the entry carries
  `{ id: <new launcher id>, storeId: A.id, lineageId }`? That splits the identity and every
  consumer must know two ids. **Chosen shape instead:** the launcher id *is* the store appId
  for original installs (`storeId` omitted ≡ `id`), and fork entries carry an explicit
  `storeId` pointing at the original's repo plus their `lineageId`. One optional field,
  paid only by forks.
- **Access discipline:** all store reads/writes for an entry go through one wrapper
  (`launcher/store-access.ts`): it checks the repo's active lineage and `switchLineage`s to
  the entry's lineage if needed, then runs the verb. Safe because exactly one mini-app is in
  the foreground (one WebView == one realm) and all launcher store access is serialized
  through this module. `fork()`'s own HEAD-switch is immediately accounted for: the wrapper
  re-switches when the *original* entry is next accessed.
- **Delete:** removes the index entry. Store data: if no other entry references the repo,
  the repo's keys are dropped from the MMKV backend via a new **additive** store verb
  `remove(appId)` (product verb, no git vocabulary; KvBackedFs deletes by key prefix). If a
  sibling lineage still references the repo, only the index entry is removed (the lineage
  stays — cheap, invisible, compactable). Per-app *user data* (the storage engine's SQLite db)
  is deleted with the app — `deleteStorage(appId)` on the engine side if absent; design
  treats both as the same task ("delete leaves no per-app residue").
- Alternative considered — fork-by-copy into a fresh repo (no shared repos, no
  `switchLineage`): rejected because it abandons the accepted fork verb and the shared-history
  property #6's history screen wants (pre-fork snapshots visible on the fork, rollback across
  the fork point — §11's aggressive-rollback practice), and it duplicates content.

### D3. Bundle delivery by source: extend the outer page's control surface, not the iframe contract

`__whimControl.reinject` gains a `bundleSource` option (string). The outer page, on reset,
delivers the host-supplied source through the *identical* path it uses for baked bundles —
`{__whimDeliver:true, bundle: src}` posted to the iframe after iframe recreation. The
iframe-side loader is byte-for-byte unchanged: channel (b) DOM-inserted inline `<script>`,
unmodified CSP, realm reset per delivery (spike-2 constraints #1–#5 all untouched; the only
new code runs in the *outer trusted page*, which already holds the bundle map).

- Transport: the host passes the source via `injectJavaScript` (it already relays sysrets this
  way). Bundles are ~4.5 KiB (H1b); the string is JSON-escaped once on the RN side. A size
  guard (refuse > ~512 KiB with a structured error) protects the `injectJavaScript` path from
  pathological future inputs.
- The baked `BUNDLES` map **stays** — it serves the dev/probe surface (adversarial fixtures:
  evil, cap-intruder, sql-injector, latency-probe) and the invariant suite's generated pages.
  Launcher launches use `bundleSource` exclusively (one uniform product path).
- `build/assemble.mjs` and `src/runtime/web/` orchestration change ⇒ `npm run build`
  regenerates `src/runtime/generated/*`; the invariants suite then runs against *this* build
  (its artifacts JSON is re-emitted) — run order in tasks reflects that.

### D4. The nav-depth seam (the #3↔#5 contract)

The contract, in full — #3 implements the SDK half against this:

- **SDK → host (hint):** whenever the mini-app's nav stack depth changes, the SDK runtime
  posts a control-family frame `{kind:'nav-depth', depth:number, generation:number}` (relayed
  to RN like all iframe→host frames). It is **deliberately unauthenticated**: the bundle shares
  the iframe scope (F4) and can forge it — but it can equally "forge" depth by calling
  `nav.push()` legitimately, so authentication buys nothing. The host treats `nav-depth` as a
  **hint, never authority**; stale-generation frames are ignored (same fencing rule as #41 D3).
- **Host → realm (request):** on system back with last-hinted depth > 0, the host posts a
  `{kind:'nav-back'}` request into the realm via the outer page (`__whimControl.navBack()` →
  postMessage into the iframe). The SDK pops its stack and emits a fresh `nav-depth`.
- **Guaranteed-exit invariant (the host-owned safety property):** the user can ALWAYS leave,
  regardless of app behavior. Mechanisms, all host-side:
  1. Depth hint == 0 (or never received — apps without nav, all of #5's apps) → back exits
     to the launcher immediately.
  2. Depth hint > 0 → forward one `nav-back`; if no depth *decrease* arrives within
     **400 ms**, the press is queued as unhandled and the **next** back press exits
     unconditionally (double-back escape — also the natural user reflex).
  3. The floating affordance (D5) always exits — it is host-rendered RN, unreachable from
     the realm.
- **Where it lives:** frame vocabulary in the runtime page parts + `src/host/bridge/contract.ts`
  (`classifyFrame` already splits control vs syscall families; `nav-depth`/`nav-back` join the
  control family). The host-side policy is a **pure state machine**
  (`launcher/back-policy.ts`: inputs = back-press / nav-depth / timeout events, output =
  exit | forward | ignore) so it is TDD-able under Node without a device.
- In this change, depth is always 0 (no SDK nav exists) — back exits at root, on-device. The
  full pop-then-exit round-trip is acceptance-tested when #3 lands; the policy machine and the
  forwarding path are unit-tested now.

### D5. Floating affordance: RN overlay, draggable, auto-dimming

Host-layer (sibling of the WebView, never inside it — the realm cannot touch or cover it):
a small circular button, drag-repositionable (PanResponder; snaps to the nearest screen
edge), dims to low opacity after ~3 s idle, full opacity on touch. Tap → exit to launcher
(single action in #5; #7 may add "new prompt" later — the menu surface from spec §10 is
deliberately deferred until there are two actions). No safe-zone logic: draggability *is* the
answer to §10's overlap risk (#42 demoted the button precisely because system back is primary).

### D6. Host screen structure: plain RN state, WebViewHost split

Three host surfaces, switched by plain `useState` in a new `LauncherRoot` (no navigation
library — two screens and a dev flip don't justify the dependency or its native config):

- **`HomeScreen`** (`src/host/launcher/HomeScreen.tsx`): grid of tiles from the index
  (derived monogram + deterministic color per app; `example` badge), `+` CTA tile
  ("make your first app" — placeholder alert/sheet until #7), long-press tile → action sheet
  (Open / Fork / Delete-with-confirm). Product verbs only — the build guard applies to every
  string here.
- **`MiniAppScreen`**: full-screen mini-app host. `WebViewHost.tsx` is refactored: the realm
  loop (registry, deliverApp, onMessage dispatch, control surface) extracts into a reusable
  **`useMiniAppHost(record, bundleSource)`** hook + `MiniAppView` component; the probe UI
  (verdict bar, fixture buttons) becomes **`DevProbeScreen`**, a thin consumer of the same
  hook over the baked fixture set. Nothing about realm/dispatcher binding changes — the
  cap-intruder lesson (always bind realm + dispatcher) is preserved by construction since the
  loop moves verbatim.
- **`DevProbeScreen`**: reachable via a dev-only entry (long-press on the launcher title in
  dev builds / `__DEV__` flag), keeping the on-device acceptance surface (deliver buttons,
  containment verdict, syscall counters) alive — it is the standing bridge/containment
  harness, not legacy UI.

`App.tsx` keeps its probe flips; default renders `LauncherRoot`.

### D7. First-run seeding

- `build/build.mjs` additionally emits `src/runtime/generated/app-bundles.ts` — fixture
  name → IIFE source (same strings already baked into `RUNTIME_HTML`), so the RN side can
  seed the version store. Generated, never hand-edited, same regeneration rule.
- On launcher mount with an empty/versionless seed marker in MMKV: for `tip-splitter` and
  `water-counter`, `store.snapshot(id, {'bundle.js': src}, <seed prompt>)` then write the
  index entry (`example: true`). Seed prompts are honest product strings ("Example: split a
  bill with tip" — they surface in #6's history). Idempotent: the marker records the seed
  version; reinstalling a deleted example is a non-goal (delete means delete; the corpus
  fixtures remain available via DevProbeScreen).
- Seeded examples are full citizens: forkable, deletable, snapshot-backed from snapshot #1 —
  so #6 has real history and fork provenance to render the day it lands.

### D8. Testing strategy (§16.1: TDD the deterministic, test-after the UI)

- **TDD under Node** (new `npm run launcher:test`, wired into CI like `vstore:test`):
  `app-index` CRUD + ordering + seed idempotence (MMKV mocked behind the existing
  `KVBackend`-style seam), `store-access` lineage discipline (fork creates entry + switches
  back correctly; delete refcounts the repo; `remove` leaves no keys), `back-policy` state
  machine (all transitions incl. the 400 ms unhandled-press escape).
- **Test-after:** screens (grid render, action sheet, affordance) — eyeballed on-device;
  no snapshot-test theater.
- **English test specs first** (§16.5): tasks.md front-loads "spec the tests in English"
  before any implementation task.
- **On-device acceptance (the Done-when):** seeded launcher → tap water-counter → runs
  (syscalls live) → system back exits → fork water-counter → forked copy runs independently
  (storage is per-launcher-entry? — NO: storage engine is keyed by appId; a fork on the same
  repo shares `storeId` but must NOT share user data. The fork's engine appId = the new
  launcher id. This is load-bearing: **the realm is launched with the launcher id as its
  engine appId**, while version-store access uses `storeId`+lineage) → delete both → no
  residue (index empty, store keys gone, SQLite db gone). Containment stays 42/42 via
  `npm run invariants` against the rebuilt runtime.

## Risks / Trade-offs

- **[Shared-repo forks complicate every later store consumer]** (#6 must respect
  `storeId`+`lineageId`). → Mitigation: the `store-access` wrapper is the only sanctioned
  path (ledger contract note); #6 reads through it, never raw `VersionStore`.
- **[`switchLineage` materializes the work tree on each switch]** — cost on fork-heavy use.
  → Bounded: tiny artifacts (≈4.5 KiB H1b bundles), switch only on actual lineage change
  (wrapper checks first); #39's measured op latencies were interactive with margin.
- **[`injectJavaScript` with a full bundle string]** — quoting/size edge cases. → Single
  JSON-escape helper + size guard + an on-device check in acceptance (water-counter delivers
  by source, not name, and must run identically).
- **[Outer-page edits sit near load-bearing runtime code]** — any `src/runtime/web/` change
  risks containment drift. → The diff is confined to the orchestration script's deliver path
  (outer trusted page; iframe parts untouched); `npm run build && npm run invariants` is the
  blocking gate and CI runs it; no CSP/sandbox/allowlist line may change (review rule).
- **[Back-policy timeout (400 ms) is a guess]** → It only governs the *unhandled-press
  escape*, not normal exits (depth-0 exits are immediate). Tune on-device; the constant lives
  in one place; double-back always works regardless.
- **[No store `remove` verb existed — additive surface change]** → Additive only, product
  verb, KvBackedFs prefix delete; `vstore:test` gains coverage; mini-app-versioning spec
  requirements untouched (nothing requires immortal repos).
- **[Fork shares the original's schema]** — fork copies `record` (manifest + schemaArtifact)
  verbatim; the fork's engine opens its own db with the same schema at first launch (D7 of
  #41: engine opens before bundle runs). No migration concerns — same schema, fresh db.

## Open Questions

- None blocking. Two deliberately deferred: the floating affordance's future menu (single
  action until #7 adds prompting) and tile iconography (#3's Icon set may upgrade tiles —
  cosmetic, non-contractual).
