# Tasks: sdk-charts

## 1. Chart geometry core (pure functions + Node suite)

- [x] 1.1 Create the chart geometry module under `src/sdk/`: value scaling with `max(maxValue ?? 0, data max, 1)` floor, bar layout, and line point mapping as pure functions (no React, no DOM)
- [x] 1.2 Calendar bucketing: `{date: 'YYYY-MM-DD', value}` day points → week-column grid model with `weeks` defaulting/clamping — day-index string arithmetic only, no local-time `Date` parsing (design decision 7)
- [x] 1.3 Intensity bucketing + ramp helper: value → 5-step bucket; bucket + theme role → composited fill over `surface`, zero-value → `border`-tinted neutral (design decision 4)
- [x] 1.4 Non-vacuous Node suite for 1.1–1.3 following the `theme.suite.ts` pattern: empty/single-point/all-zero/all-equal series, negative clamping, non-finite dropping, DST-transition and year-boundary dates
- [x] 1.5 Wire the suite into an existing Node suite runner (first verify how `launcher:test`/sibling `*:test` scripts discover suite files; if a `package.json` script edit is unavoidable, stop and hand that single edit to the main thread — hook-protected)

## 2. Chart component

- [x] 2.1 `src/sdk/charts.tsx`: the `ChartProps` discriminated union (design decision 2) + the shared SVG frame — viewBox coordinate system, 100% width, reserved height from space tokens, and the empty-data muted placeholder path (spec: Degenerate data renders safely)
- [x] 2.2 Bar rendering: one `<rect>` per point scaled to the derived/pinned max, labels beneath, optional value labels via `showValues`
- [x] 2.3 Line rendering: single `<polyline>` in data order scaled min→max, endpoint marks, optional value labels
- [x] 2.4 Heatmap rendering: week-grid `<rect>` cells with ramp fills from 1.3, neutral cells for unsupplied days
- [x] 2.5 Export `Chart` (+ its prop types, type-only) from `index.tsx` matching the `controls.tsx`/`surfaces.tsx` re-export pattern; `npm run build` green (typecheck, bundle, source-map round-trip; no resolver/CSP edits)

## 3. Gallery, reference doc, close-out

- [x] 3.1 Style-gallery Charts section: populated bar (week of per-category spending), line (30-point trend), heatmap (~12 weeks of habit days) from hardcoded local-state demo data, plus one empty-data chart showing the placeholder — gallery stays `capabilities: []` (spec: gallery requirement)
- [x] 3.2 `docs/sdk-reference.md`: Charts subsection in §2 — props table + data-shape code fence mirroring the landed source verbatim (never invent a prop/default)
- [x] 3.3 Close-out bookkeeping: `docs/decisions.md` entry (corpus-need per #44 already recorded in sdk-gap/app-corpus), `docs/v1-roadmap.md` ledger flip for #4, `docs/capabilities.md` pointer to the `sdk-charts` spec
- [x] 3.4 Full validation: `scripts/gate.sh` green during the loop, then `scripts/gate-full.sh` once before merge (Chromium invariant suites must pass unchanged — charts add no containment surface)
