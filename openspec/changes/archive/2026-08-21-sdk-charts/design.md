# Design: sdk-charts

## Context

The corpus pins exactly three chart shapes — bar, line, calendar-heatmap — as declarative, data-as-props, tokens-only rendering (research.md §1). The SDK's component conventions are settled by sdk-design-system: string-literal-union props with defaults, styles built per-render from token resolvers reading the active `WhimTheme`, no CSS classes (research.md §2). Charts must be fully self-contained under the locked CSP — no network, no external assets; canvas is excluded as a product decision (research.md §6). This change depends on the sdk-design-system branch being merged (theme contract + gallery fixture).

## Goals / Non-Goals

**Goals:**
- One `Chart` export covering `bar`, `line`, `heatmap` — the model-friendly single doc entry the gap doc anticipated.
- Theme-correct in light and dark mode using only the existing 10 color roles.
- Safe on degenerate input; documented in `docs/sdk-reference.md` as the canonical charting idiom.
- Pure, Node-tested geometry.

**Non-Goals** (corpus-pinned exclusions, research.md §1):
- Pie/scatter/donut/sparkline, tooltips, pan/zoom, animation, canvas.
- Multi-series data, new color tokens, interactive marks, storage-bound data binding, new hooks.

## Decisions

1. **Single `Chart` export with a `kind` discriminant** (not `BarChart`/`LineChart`/`Heatmap`). The gap doc reserved exactly one budget slot and calls the single entry "the model-friendly shape" (research.md §1); one discriminated union is one doc entry for the prompt surface. Alternative (three components) rejected: triples the export/doc surface for zero corpus gain.

2. **Props contract** (discriminated union, mirroring the SDK's literal-union style):
   ```ts
   type ChartTone = 'primary' | 'positive' | 'warning' | 'danger';
   type SeriesPoint = { label: string; value: number };
   type DayPoint = { date: string /* YYYY-MM-DD */; value: number };
   type ChartProps =
     | { kind: 'bar' | 'line'; data: SeriesPoint[]; tone?: ChartTone; showValues?: boolean; maxValue?: number }
     | { kind: 'heatmap'; data: DayPoint[]; tone?: ChartTone; weeks?: number };
   ```
   `tone` defaults to `'primary'`; `showValues` defaults to `false`; `maxValue` pins the scale (else derived from data); `weeks` defaults to 12 (clamped to a sane range). Apps derive these arrays themselves from `records.list` results — no data-binding mechanism exists to displace (research.md §4).

3. **Render medium: one inline `<svg>` per chart** (viewBox coordinate system, 100% width, height from space tokens), marks as `<rect>`/`<polyline>`/`<circle>` with fills/strokes resolved from theme colors. Line needs SVG anyway; using it for all three gives one coordinate system, one geometry pipeline, crisp rendering at any DPR. React handles the SVG namespace natively under classic `React.createElement` — no runtime or CSP change (`style-src 'unsafe-inline'` already covers inline presentation). Alternative (flex-div bars, CSS-grid heatmap) rejected: two layout systems, and the line chart still needs SVG.

4. **Colors reuse the closed role set — no new tokens** (research OQ1). Single series per chart (corpus demands none higher): marks use the `tone` role. Heatmap intensity is a 5-step ramp: the tone color composited at stepped opacity over `surface`, with zero-value cells drawn as `border`-tinted neutral — derived at render time from the active theme, so dark mode needs no special casing.

5. **Degenerate data is spec-level behavior** (not incidental): empty `data` renders the chart frame with a muted `text-muted` placeholder ("No data yet") at full reserved height — never a throw, never a zero-height collapse. Bar/heatmap clamp negative values to 0 (documented); line scales min→max of finite values; non-finite entries are dropped. Scale max is `max(maxValue ?? 0, data max, 1)` so all-zero data renders an empty track instead of dividing by zero.

6. **No interactivity on marks** (research OQ3): no `onPress`, no `emitUiEvent`, no `usePressed`. The habit tracker's "tap a day" flows through regular controls; the heatmap is display-only in v1.

7. **Geometry as pure module-level functions, computed inline per render** (research OQ5): scaling/nice-max, bar/line point mapping, calendar bucketing (YYYY-MM-DD → week-column grid), intensity bucketing. Personal-scale data (≤ a few hundred points) needs no memoization, so no `useMemo` export question arises. Date math parses the date string directly (day-index arithmetic, no timezone-sensitive `Date` round-trips) — heatmap bucketing must be immune to TZ/DST (suite covers boundary dates).

8. **Gallery demo data is hardcoded** (research OQ4): the Charts section keeps the gallery's `capabilities: []` local-state convention with realistic inline arrays (a week of per-category spending for bar, a 30-point trend for line, ~12 weeks of habit days for heatmap) plus one deliberate empty-data chart demonstrating the placeholder. No new fixture file → the hook-protected `build/build.mjs` maps stay untouched (research.md §8).

9. **Spec home: new `sdk-charts` capability** (research OQ2): a delta against the unarchived `sdk-design-system` capability couldn't validate/sync independently of that change's archival; minting a capability follows the precedent sdk-design-system itself set against `sandbox-rendering` (research.md §5).

10. **Testing split** (research.md §8): geometry gets a non-vacuous Node suite following the `theme.suite.ts` pattern; visual/containment correctness rides `npm run build` + the unchanged Chromium invariants + the gallery on-device eyeball. No new Chromium suite — Chart adds no containment-relevant surface.

## Risks / Trade-offs

- [Suite wiring may require a `package.json` script — hook-protected] → First try folding the geometry suite into an existing Node runner's discovery (verify how `launcher:test` resolves suite files); if a script edit is unavoidable it is an explicitly main-thread task, never an implementer edit.
- [Heatmap date arithmetic is a classic TZ/DST bug farm] → Pure string/day-index math, no local-time `Date` parsing; suite includes DST-transition and year-boundary dates.
- [SVG rendering unverified on the real Android System WebView] → Desktop Chromium build + invariants are the fast pre-check; the gallery Charts section is the on-device acceptance surface (same policy as the rest of the component kit).
- [Doc drift between `charts.tsx` and `docs/sdk-reference.md`] → The reference "mirrors src/sdk verbatim, never invents a prop/default"; the docs task is written against the landed props type, and the reviewer checks the table against the source.
- [`kind`-discriminated union grows awkward if v2 adds many kinds/options] → Accepted: the corpus caps v1 at three kinds; revisit only with new corpus evidence (#44 rule).

## Migration Plan

Purely additive export; nothing to migrate or roll back beyond reverting the change. `npm run build` regenerates runtime artifacts; no invariant edits.

## Open Questions

None blocking — the five researcher questions are resolved by Decisions 4, 9, 6, 8, 7 respectively.
