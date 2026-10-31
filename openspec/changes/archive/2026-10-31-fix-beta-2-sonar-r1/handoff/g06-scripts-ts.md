# g06-scripts-ts handoff

S13: fixed (structural) only-filter.mjs `edits.toReversed()`
S35: fixed (structural) android-project.ts String.raw (val regex)
S36: fixed (structural) decorNames is a Set, `.has`
S37: fixed (structural) `arg.endsWith('.decorView')`
S38: fixed (structural) android-project.ts String.raw (fun regex)
S48: fixed (structural) configChanges is a Set, `.has`
S90: fixed (structural) removal-ratchet.mjs: vocabulary `suiteImport` regex replaced by `suiteImportSuffix: '.suite'` + `endsWith` (the only use)
S141: fixed (structural) `Object.hasOwn`
S163: fixed (structural) design-tokens.ts jsString uses replaceAll
S164: fixed (structural) same line
S165: fixed (structural) String.raw for the backslash replacement
S166: fixed (structural) reduce given initial `[[], Infinity]`; the input is the constant 5-element FIT_STARTS so empty input is unreachable, result identical for non-empty (first element always wins over Infinity-1e-12). No behavioral test possible.
S167: fixed (structural) String.raw in findRegion
S300: accept-proposed

## Accept proposals
S300: assets.ts generateAssets loop; each `render()` launches and closes its own headless Chromium (renderPng), so converting to Promise.all would start one browser per ASSET_TABLE row at once (dozens): memory blowup on the shared Mac and CI. Sequential is deliberate.

## Red-check
none: all structural

## Commands (exit codes)
- npm run -s build: 0
- node scripts/test/removal-ratchet.test.mjs: 0 (63 passed)
- npx eslint --max-warnings 0 <5 touched files>: 0
- npm run -s typecheck: 0
- npm run -s checks:test: 1, 461 pass / 1 fail. The failure is `tracked weight` (no .txt evidence under openspec/changes/) caused by this change's own allowlists/*.txt and evidence/*.txt files, not by lane code; android-project and assets suites passed.

## Deviations
Finding line numbers for S90/S35/S38/S163-167 had drifted; fixed the matching constructs located by search.
