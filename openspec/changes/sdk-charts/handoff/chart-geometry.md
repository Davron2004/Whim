# chart-geometry — interface (chain-1 sdk-chart-geometry)

Module: `src/sdk/chart-geometry.ts`. Pure functions, no React/DOM/`Date`.

## Shared types

```ts
type ChartTone = 'primary' | 'positive' | 'warning' | 'danger';
interface SeriesPoint { label: string; value: number }
interface DayPoint { date: string /* YYYY-MM-DD */; value: number }
type IntensityBucket = 0 | 1 | 2 | 3 | 4;
```

## Scale

```ts
function computeScaleMax(values: readonly number[], maxValue?: number): number
```
`max(maxValue ?? 0, dataMax, 1)` where `dataMax` is over finite, `Math.max(0, v)`-clamped values. Never 0.

## Bar

```ts
interface BarPoint { label: string; value: number; heightFraction: number } // value >= 0, heightFraction 0..1
interface BarLayout { bars: BarPoint[]; scaleMax: number }
function computeBarLayout(data: readonly SeriesPoint[], maxValue?: number): BarLayout
```
Non-finite points dropped entirely. Remaining values clamped to `>= 0`. All-zero/empty → `scaleMax` floors to 1, every `heightFraction` is `0` (empty track, never NaN).

## Line

```ts
interface LinePoint { label: string; value: number; xFraction: number; yFraction: number } // both 0..1
interface LineLayout { points: LinePoint[]; domainMin: number; domainMax: number }
function computeLineLayout(data: readonly SeriesPoint[], maxValue?: number): LineLayout
```
Non-finite points dropped entirely; remaining values NOT clamped (min→max of finite values). `maxValue` only raises `domainMax`, never lowers below data max. Empty → `{ points: [], domainMin: 0, domainMax: 1 }`. Zero-span domain (single point or all-equal) → every `yFraction` is `0.5`; a lone point's `xFraction` is `0.5`. Never NaN.

## Calendar day-index (pure integer arithmetic — no `Date`, immune to host TZ/DST)

```ts
function dayIndexFromDate(date: string): number | null   // 'YYYY-MM-DD' -> days since 1970-01-01, or null
function dateFromDayIndex(dayIndex: number): string       // inverse; zero-padded 'YYYY-MM-DD'
function dayOfWeekFromIndex(dayIndex: number): number      // 0 (Sun) .. 6 (Sat)
```
`dayIndexFromDate` returns `null` for wrong shape, month outside 1..12, or a day that does not exist in that month/year (leap years honored, e.g. `2023-02-29` → null, `2024-02-29` → valid).

## Intensity

```ts
function computeIntensityBucket(value: number, scaleMax: number): IntensityBucket
```
Non-finite or `<= 0` → bucket `0`. Otherwise `(0, scaleMax]` divided into even quarters, `ceil`, clamped to `[1,4]`. `scaleMax <= 0` treated as `1` (never NaN/Infinity).

```ts
interface IntensityRampColors { tone: string; surface: string; border: string } // '#rrggbb'
function intensityFill(bucket: IntensityBucket, colors: IntensityRampColors): string
```
Bucket `1..4` → `tone` alpha-composited over `surface` at `25/50/75/100%`. Bucket `0` → `border` composited over `surface` at a fixed `40%` (neutral tint — same fill for zero-value and unsupplied cells). Malformed hex (either input) never throws: falls back to `surface` verbatim.

## Calendar grid

```ts
interface CalendarCell { date: string; weekIndex: number; dayOfWeek: number; value: number | null; bucket: IntensityBucket }
interface CalendarGrid { weeks: number; cells: CalendarCell[][]; scaleMax: number } // cells[weekIndex][dayOfWeek], 7 rows/column
function computeCalendarGrid(
  data: readonly DayPoint[],
  opts?: { weeks?: number; endDate?: string; maxValue?: number },
): CalendarGrid
```
`weeks` defaults to `12`, clamps to `[1, 53]` (non-finite/omitted → default). Columns are Sunday-aligned calendar weeks; the last column contains `endDate` (explicit `'YYYY-MM-DD'` anchor — **this module never reads the wall clock**; a caller must supply "today" if that's the intended anchor). If `endDate` is omitted/unparseable, the anchor is the latest valid date present in `data`, or day-index `0` for empty/all-invalid data. Malformed dates and non-finite values are dropped (that day becomes an unsupplied cell); negative values clamp to `0`. Every day in the window gets a cell: unsupplied → `value: null`, `bucket: 0`. `scaleMax` is `computeScaleMax` over all valid (clamped) values in `data`, independent of the visible window. Never throws.

## Error surface (all functions)

Never throw. Degenerate/empty/malformed input yields a placeholder-friendly, NaN-free result per the shapes above — the caller (chain-2's `Chart` component) can render directly from any output.
