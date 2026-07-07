# Research digest: sdk-design-system (condensed from three researcher passes, 2026-07-02)

## SDK surface (src/sdk/)

- Two files only: `index.tsx` (everything) + `tokens.ts`. Components: `Screen{padding}`, `Stack{gap}`, `Row{gap}` (shares StackProps), `Text{size,color,weight}`, `Heading{size,color}`, `NumberInput{label,value,min,max,step,onChange}`, `Button{label,radius,onPress}`. Plus `useState/useEffect/useRef` re-exports, `delay/interval`, `defineApp/AppSpec/ScreenComponent`, `storage`, `cues` facades, type-only re-exports.
- `index.tsx:417-421` comment: `Slider`/`SegmentedControl` deliberately deferred to "the SDK design-system change" — this change.
- `tokens.ts:10-14` flags the palette as placeholder pending "SDK design-system change (design D6)".
- Token types: `SpaceToken none|xs|sm|md|lg|xl` (0/4/8/12/20/32px), `RadiusToken none|sm|md|lg|full` (0/6/12/20/999px), `ColorToken text|text-muted|primary|on-primary|bg|surface|border|danger`, `TextSizeToken caption|body|subtitle|title|display`, `WeightToken regular|medium|semibold|bold`. Resolvers `space()/radius()/color()/weight()/textSize()` map token→CSS string, safe default on undefined.
- Render mechanism: pure `React.createElement('div'|'button'|...,{style:{...inline objects}})`. No `<style>` tag, no classes, no DOM APIs in the SDK. Mount happens once in `loader.js:86-88` via `ReactDOM.createRoot(...).render(createElement(spec.screens[spec.initial]))`.
- Interactive components call `emitUiEvent('press', label)` before user callbacks (probe telemetry pattern — follow it in new components).
- Font stacks are hardcoded (`system-ui, sans-serif` in Button, `system-ui, -apple-system, sans-serif` in Screen) — not tokenized.
- `NumberInput` carries `WebkitAppearance:'none'`/`MozAppearance:'textfield'`/`outline:'none'` to satisfy sandbox-rendering spec req "no stray native focus artifacts" — new inputs need the same discipline.

## SDK injection / what a new export costs

- `build/vc-sdk-inject.ts` does `import * as VcSdk from '../src/sdk'` → `globalThis.__WHIM_VC_SDK__`. Resolver (`src/runtime/web/resolver.js:22-46`) gates module **specifiers** only (`vc-sdk`→`__WHIM_VC_SDK__`, `react`, `react-dom`; anything else throws). **New named exports from `src/sdk/index.tsx` ship automatically after `npm run build` — zero allowlist/resolver/manifest edits.** New internal SDK files are fine if re-exported through index.tsx.
- Manifest extraction (`build.mjs:84-117`) resolves `vc-sdk` to the real `src/sdk/index.tsx`, so it can't drift.
- Never hand-edit `src/runtime/generated/*` / `build/generated/*`; regenerate with `npm run build`.

## Host→iframe data flow (the theme seam)

- Handshake (loader.js:213-218 + assemble.mjs:127-145): iframe posts `{__whimHarness:true, kind:'hello'}` → host posts `{__whimHostInit:true, nonce, gen}` (nonce→closure in loader.js:194-195, gen→syscall.js:89) → host posts `{__whimDeliver:true, bundle|source}`.
- **No host→app config/theme channel exists today.** A data-only theme field can ride `__whimHostInit`; iframe-side install site is loader.js (trusted pre-injected script); SDK-side read seam precedent: `globalThis` lookups at index.tsx:160-162 (`ReactNativeWebView`) and :183 (`__whimSyscall`).
- Launch path RN-side: `LauncherRoot.onOpen` → `access.activeBundle(app)` → `MiniAppView{record,bundleSource,engineAppId,onExit}` → `useMiniAppHost.deliverBySource()` (useMiniAppHost.ts:146-158) → `deliverBySourceJs` (deliver.ts:48-60) → `window.__whimControl.reinject({reset,bundle,bundleSource,generation})` on the OUTER page. `host.control(js)` injects into the outer page only — cannot reach the cross-origin iframe.
- The outer-page `__whimControl` + hostInit frame composition lives in `build/assemble.mjs` (hook-protected, main-thread-only edit).

## Launcher shell (src/host/launcher/)

- `LauncherRoot.tsx:26-29`: `Screen = {kind:'home'} | {kind:'app',app,record,source,engineAppId} | {kind:'dev'}` — plain useState switch, no nav library. `App.tsx` wraps in `SafeAreaView edges={['top']}`.
- Files: LauncherRoot (wiring), HomeScreen (grid + create CTA + long-press sheet), MiniAppView (WebView host), DevProbeScreen (__DEV__ only), FloatingExit (draggable exit, core Animated/PanResponder), useMiniAppHost (realm loop).
- **No shared theme module; every screen inlines hex literals** (`#0b1020` bg repeated in 5 files; grays `#e5e7eb/#94a3b8/#64748b`; accents `#93c5fd/#bfdbfe/#f87171`). `tiles.ts` has `TILE_COLORS` (8 hexes) + monogram for per-app tiles.
- All user-facing strings MUST live in `copy.ts` (`COPY` + helpers) — `product-verbs.suite.ts` enforces no git/mechanism vocabulary.
- `AppIndex` (app-index.ts): `InstalledApp{id,name,example?,createdAt,record,storeId?,lineageId,forkedFrom?}` over `KVBackend{getString,set,delete,getAllKeys}`; MMKV instance `whim.launcher` on device, `MapKVBackend` in tests. Fixed-key precedent: `SEED_KEY`/`ORDER_KEY`.
- Persistence for a theme pref: same `createMmkvBackend('whim.launcher')` KVBackend, new fixed key.
- `seedFirstRun` (seed.ts:34-53): idempotent via `SEED_VERSION=1` + per-id has() skip; `defaultSeeds()` pulls from generated `APP_RECORDS`/`APP_BUNDLES`; installs via `access.install` (snapshot #1 + AppIndex entry, `example:true`).
- BackPolicy: only `useMiniAppHost` registers a back handler; new screens are safe if they never feed BackPolicy events. `BackEvent/BackAction/BackState` in back-policy.ts:20-50.
- Tests: `npm run launcher:test` = esbuild-bundled `test/acceptance.ts` under plain Node (no jest, no RN renderer) via shared `Harness` (ok/eq/test/throws); suites: back-policy, app-index, store-access, seed, product-verbs, dev-probe-back-button, unmount-teardown, deliver. Pure logic only — new theme logic must be a pure module to be testable here.
- RN deps available: react 19.2.3, react-native 0.85.3, react-native-mmkv ^4.3.1, react-native-safe-area-context ^5.5.2, react-native-webview ^13.16.0. **No icon/gesture/reanimated/svg libs — do not add dependencies (package.json is hook-protected).**

## Fixtures & build registration

- Fixture = one file importing only `vc-sdk`, `export default defineApp({name, initial, screens, capabilities})` (see fixtures/tip-splitter.app.tsx).
- Enumeration is a hand-written `APPS` map at `build/build.mjs:188-202` (hook-protected — main-thread edit); launcher-visible bundles additionally listed in the `bundles:` object at build.mjs:283-291; RN-side seeding reads generated `app-records.ts`/`app-bundles.ts`.
- Non-adversarial manifest-extraction failures throw the build (B3 guard).

## Constraints (decision-cited)

- #13 tokens-not-values: components take semantic tokens, never hex/px/arbitrary styles. Missing token = feature request.
- #11 backend-agnostic contract: no DOM concepts in the component API (native-reconciler revert option).
- #37/H1b: classic JSX (`tsconfigRaw:'{}'` load-bearing), single IIFE, closed resolver `{vc-sdk,react,react-dom}`.
- #35/#37: CSP has no unsafe-eval; **never widen the CSP**; never value-replace Function/eval.
- #44 + roadmap #3 "ceiling discipline": every export needs a corpus need — **explicitly waived by the owner for this change** (recorded in proposal.md); ~60-80 exports stays a ceiling.
- #43 D1-D8 launcher-shell as-built: delivery-by-source stays byte-identical channel-(b), zero CSP/sandbox/allowlist edits; fork = own storage appId; #42: system back is primary exit, FloatingExit demoted.
- sandbox-rendering spec: mount-to-first-paint ~150ms ceiling for trivial app; no native chrome leaks fixed only in SDK styles.
- Scaffolding tripwires (gate.sh:64-67 + CI): no `TEMP:`, `HACK:`, `isImplemented`, `IS_IMPLEMENTED`, `console.log(.*debug` in src/**.

## OpenSpec mechanics

- Delta files: `## ADDED|MODIFIED|REMOVED|RENAMED Requirements` → `### Requirement: <name>` (body MUST contain SHALL/MUST, not too brief) → `#### Scenario: <name>` with `- **WHEN**/- **THEN**` (+ **AND**). `--strict` fails on warnings.
- chains.md: 3-7 tasks/chain (≤~800-line diff), grouped by files/layer; `## chain-N` blocks with tasks/rationale/reads/writes-contract; handoff = interface only (schema template caps 120 lines; CLAUDE.md says 60 — use 60 to be safe); flag chains touching hook-protected files as NOT IMPLEMENTER-DISPATCHABLE.
- gate.sh: build → typecheck → lint --max-warnings 0 → vstore/storage/bridge/launcher/server tests → tripwire grep. gate-full.sh adds: knip, guard:metro, invariants, bridge:invariants, launcher:deliver-verify, openspec validate --all --strict.
- Roadmap: this change IS #3 `sdk-design-system` (L). Launcher-theme scope exceeds the mapped #5 (done) — needs an "Open deltas" ledger note in docs/v1-roadmap.md per its protocol. Out-of-scope per roadmap: Chart (#4), history UX (#6), prompt flow (#7).
