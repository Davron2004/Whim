# chart-props — interface (chain-2 sdk-chart-component)

Module: `src/sdk/charts.tsx`. Component `Chart`, pure display (no bridge traffic, no new
hooks, no interactive marks — usable with `capabilities: []`).

## `ChartProps` (verbatim)

```ts
type ChartProps =
  | { kind: 'bar' | 'line'; data: SeriesPoint[]; tone?: ChartTone; showValues?: boolean; maxValue?: number }
  | { kind: 'heatmap'; data: DayPoint[]; tone?: ChartTone; weeks?: number };
```

`ChartTone`, `SeriesPoint`, `DayPoint` are re-exported from `./chart-geometry` verbatim (not
redeclared) — see `handoff/chart-geometry.md` for their shapes.

## Prop defaults and effects

- `tone` — default `'primary'`. Resolves to a hex color via `tokens.ts#color(tone)` against
  the ACTIVE theme; the single series (bar/line) or heatmap ramp uses this role throughout.
- `showValues` — default `false` (bar/line only). When `true`, one numeric value label
  (`String(point.value)`, unrounded) renders per point — above each bar, or above each line
  point. Bar's per-point axis label (the `label` field) always renders regardless of
  `showValues`.
- `maxValue` — default undefined (derived from data). Bar/heatmap: pins the scale ceiling
  (never lowers below the data max — geometry's floor). Line: only raises `domainMax`, never
  lowers it below the series' own max.
- `weeks` — default `12` (heatmap only), applied by `chart-geometry.ts#computeCalendarGrid`
  (clamps to `[1, 53]`; this component never overrides that default itself, just passes
  `props.weeks` through, `undefined` included).

## Empty-data placeholder

Trigger: `props.data.length === 0` (checked before `kind` dispatch, applies to all three
kinds identically). Renders the SAME reserved frame (`height: calc(<space('xl')> * 5)` —
`160px` in the current token scale, fixed regardless of container width) containing a
centered `text-muted`-colored span with the exact text **`"No data yet"`**. Never a
collapse, never a throw. A `data` array with non-empty length but all-non-finite/degenerate
values does NOT trigger the placeholder — it renders through the geometry's degenerate-safe
output (e.g. zero bars, an empty-track scale) instead.

## Frame shape (all kinds)

One outer `<div>` (`width: 100%`, fixed `height`) containing one inline `<svg
viewBox="0 0 100 50" preserveAspectRatio="none">` with `width: 100%; height: 100%`. Marks are
`<rect>`/`<polyline>`/`<circle>`/`<text>`, fills/strokes from `color(...)` — no CSS classes,
no canvas, no external resources.

## `src/sdk/index.tsx` re-exports

```ts
export { Chart } from './charts';
export type { ChartProps, ChartTone, SeriesPoint, DayPoint } from './charts';
```

`Chart` is the only value export; every type crossing the barrel is `export type` (type-only
— nothing executable added to the `vc-sdk` re-export beyond the `Chart` function itself).

## Wall-clock discipline

`Chart` never reads `Date.now()`/`new Date()`. The heatmap calls
`computeCalendarGrid(data, { weeks })` WITHOUT an `endDate` — the grid's anchor is the latest
valid date present in `data` (geometry's own fallback), never "today".

## Error surface

Never throws. Mirrors `chart-geometry.ts`'s degenerate-input guarantees; the only branch this
component owns beyond geometry is the empty-data placeholder above.
