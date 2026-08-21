# Proposal: sdk-charts

## Why

Two Tier-0 corpus apps are blocked on charts — the spending tracker needs bar+line ("show me a weekly graph", "a chart of where my money goes each month") and the habit tracker needs a calendar heatmap — and `Chart` is the one export pre-reserved for them in the v1 export budget (`docs/sdk-gap.md` §5). The SDK reference is the future generation system-prompt surface, so the charting idiom must exist and be documented before `generation-loop` (#11) consumes it.

## What Changes

- One new SDK export: `Chart`, a declarative, data-as-props component with `kind: 'bar' | 'line' | 'heatmap'` — exactly the three shapes the corpus pinned (`docs/app-corpus.md`). Pure rendering: no capability declaration, no bridge involvement, no new hooks.
- Rendering is a self-contained inline SVG styled entirely from theme color roles (tokens, not values) — works in light and dark mode, no new color tokens, no external assets, no canvas, within the locked CSP.
- Degenerate data is a first-class behavior: empty data renders a muted placeholder (never throws); single-point and all-equal-value data render sensibly.
- The style gallery gains a Charts section demonstrating all three kinds with seeded (hardcoded, realistic) demo data, following the gallery's existing local-state convention — so charts always render with something to show.
- `docs/sdk-reference.md` gains a Charts subsection in §2 (props table + data-shape code fence), keeping the prompt surface in lockstep.
- Chart geometry (scaling, nice-max, line-point mapping, calendar bucketing, intensity ramp) lands as pure functions with a non-vacuous Node suite, following the `theme.suite.ts` pattern.
- Close-out bookkeeping: decisions.md entry (per the #44 corpus-need rule — the corpus justification already exists), v1-roadmap ledger flip for #4, `docs/capabilities.md` pointer.

Explicitly **not** in scope (corpus-pinned exclusions): pie/scatter/donut/sparkline, tooltips, pan/zoom, animation, canvas, multi-series data, interactive (pressable) chart marks, storage-bound data binding (apps pass plain arrays they derive from `records.list` themselves).

## Capabilities

### New Capabilities
- `sdk-charts`: the mini-app charting surface — what chart kinds exist, how they take data, how they theme, and how they behave on degenerate input. Minted as its own capability (the same way `sdk-design-system` minted its own rather than extending `sandbox-rendering`) — deliberately not a delta against the `sdk-design-system` capability, which is not yet archived into `openspec/specs/`, so a delta against it could not validate or sync independently of that change's archival order.

### Modified Capabilities

None. No requirement-level change to any existing capability: the sandbox contract, bridge, storage, tokens/theme contract, and build pipeline are untouched.

## Impact

- `src/sdk/`: new `charts.tsx` module (+ pure geometry helpers), re-exported from `index.tsx` exactly like `controls.tsx`/`surfaces.tsx`. Export count goes ≈35 → ≈36, well under the 42 ceiling.
- `fixtures/style-gallery.app.tsx`: new Charts section (no new fixture file → no edits to the hook-protected `build/build.mjs` `APPS`/`bundles` maps).
- `docs/sdk-reference.md`, `docs/capabilities.md`, `docs/decisions.md`, `docs/v1-roadmap.md`: documentation/ledger updates.
- New Node geometry suite wired into an existing suite runner (how `launcher:test`/sibling runners discover suites must be verified at implementation; a `package.json` script edit, if unavoidable, is main-thread-only — hook-protected).
- Regenerated `src/runtime/generated/*` / `build/generated/*` via `npm run build` (auto-generated, never hand-edited).
- Depends on the `sdk-design-system` change (theme/token contract, gallery fixture) being merged first; no other change is affected.
