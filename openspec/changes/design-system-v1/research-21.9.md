# Research digest: task 21.9 (fixture tint/icon extraction) — 2026-10-20, read-only, nothing run

## Current behaviour
- Wire path: server check stage runs `runStaticChecks(source)` (server/src/generation/stages/check.ts:35-42,66);
  `checks/passes/manifest-extraction.ts:224-265` fills `manifest.{tileColor,tint,icon}` (tint ranked ≤3, aliases;
  icon via `resolveGlyph`). The wire manifest is untyped; `mapWireRecord` (build-lifecycle.ts:93) spreads it into
  `AppManifest` via a cast. New install: `declaredTile(wire.manifest, …)` → `InstalledApp.tint/icon`
  (build-lifecycle.ts:245-246). `tileOf()` = override, else stored tint/icon, else `EXAMPLE_TILES[id]` / `declaredTile`.
- Fixture path: `build/build.mjs` `extractAppRecord` (90–127) evaluates the bundle and passes only `spec.tileColor`.
  `src/runtime/generated/app-records.ts` has no tint/icon. Examples are fine (seed.ts:61 fixed `EXAMPLE_TILES`);
  non-example fixtures (pour-over-timer, … via dev-probe-fixtures.ts:27) ignore their declared tint/icon → hash fallback.
- `AppManifest` (src/host/bridge/contract.ts:256-267) has `capabilities`, `tileColor?`, no tint/icon. The generated
  `Record<string, AppRecord>` literal would fail excess-property checks once tint/icon appear (inferred, not run).

## Bootstrap commit (HUMAN-BOOTSTRAP; on integration/beta-2 after chain-21 merges)
1. build.mjs: lazily esbuild-bundle `checks/index.ts` (platform node, format esm, `tsconfigRaw:'{}'`,
   `external:['typescript']`, outfile from `scripts/lib/tmp-bundle.mjs` `tmpBundlePath('build-static-checks', ROOT)` —
   must live inside the checkout so `typescript` resolves); `extractTile(entry)` = `runStaticChecks(source).manifest`
   picking `tileColor`/`tint`/`icon` when defined; spread into the record's manifest instead of `spec.tileColor`.
   Same default filename as the wire path (no `filename` option).
2. `AppManifest`: `tint?: string[]`, `icon?: string` (plain strings; host re-validates in `declaredTile`; keeps design
   types out of the bridge contract).
3. `src/host/launcher/test/version-record.suite.ts:374` asserts the saved manifest is exactly `{capabilities}` →
   update (water-counter's saved manifest gains tint/icon).

## Chain 21e (after the bootstrap)
- Drop `tileColor` at fixtures/tip-splitter.app.tsx:55, water-counter.app.tsx:89, style-gallery.app.tsx:446.
- checks/test/acceptance.ts:446-460 (+ import :57) and tile-colour.suite.ts:117-129, 162-165 → assert tint/icon
  (e.g. `APP_RECORDS[id].manifest.tint[0] === EXAMPLE_TILES[id].tint`, icon matches; rebuild the "mimic" from tint/icon).
  version-record.suite.ts:376 becomes vacuous — rewrite. tile-identity.ts:42-43 comment stale.
- Full removal (pre-release): tiles.ts:19-23 + index.ts:16 export; manifest-tile-color.ts and build-lifecycle.ts:37,77-96,
  236-263 (ghost colour); store-access.ts:104,126,148; bridge contract.ts:258-266; declaredTile legacy branch
  (tile-identity.ts:83) and `nearestTint`; NOT sdk/index.tsx:168-175 / app-spec.acceptance.ts:18,42-46 — the
  sdk-design-system delta says `defineApp` `tileColor` SHALL keep working and no export is removed (keep the type,
  the host just ignores the value; the checker may keep extracting-and-ignoring or drop it); checks
  contract.ts:219-221, manifest-extraction.ts:129-139,247,261; server check.ts:31 comment, wire-v2.suite.ts:592;
  tests build-lifecycle.suite.ts:239-321, store-access.suite.ts:641, tile-colour.suite.ts:59-114,185-186,201-204,
  product-verbs.suite.ts:10,32. Keep prompts.suite.ts:612/637 (they enforce docs never mention tileColor).
- Takes 21.4's tile-colour deletions (`manifest-tile-color.ts`, `ghostTileColorFor`, `appColor`).

## Risks
- Unverified: tsc, build, suites. history-ui.suite.tsx:877/1385 and version-record.suite.ts:171/302/433 not checked
  for deep-equality on the manifest.
- runtime-artifacts.json appRecords (invariants bridge runner.mjs:38,103) uses capabilities only; guard:metro is a byte
  floor; adversarial extracted fixtures may yield no static manifest (no tile fields, as today); a checker-bundle
  load failure lands in extractAppRecord's catch → build throws on extract failures (loud, not silent).
- Two read paths for a fixture: capabilities from evaluation, tile from the static AST (same `defineApp` literal).
