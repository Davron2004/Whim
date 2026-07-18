// ─────────────────────────────────────────────────────────────────────────────
// vc-sdk — chart geometry (design sdk-charts, decisions D2/D4/D5/D7). Pure data +
// pure functions: value scaling, bar/line point mapping, calendar day-bucketing, and
// intensity-ramp color compositing. NO React, NO DOM, NO `Date` object — degenerate
// input (empty / all-zero / all-equal / negative / non-finite) never throws and never
// produces NaN geometry (D5); calendar day math is pure day-index integer arithmetic,
// so it is immune to host timezone/DST (D7).
// ─────────────────────────────────────────────────────────────────────────────

export type ChartTone = 'primary' | 'positive' | 'warning' | 'danger';

export interface SeriesPoint {
  label: string;
  value: number;
}

export interface DayPoint {
  date: string; // 'YYYY-MM-DD'
  value: number;
}

// ── scale ────────────────────────────────────────────────────────────────────

/** `max(maxValue ?? 0, data max, 1)` — the shared scale-max floor (D5): all-zero or
 *  empty data always yields a usable, non-zero scale. Non-finite values are ignored;
 *  negatives are clamped to 0 before taking the max (bar/heatmap semantics — the
 *  domain is always `[0, scaleMax]`). */
export function computeScaleMax(values: readonly number[], maxValue?: number): number {
  let dataMax = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    const clamped = Math.max(0, v);
    if (clamped > dataMax) dataMax = clamped;
  }
  return Math.max(maxValue ?? 0, dataMax, 1);
}

// ── bar ──────────────────────────────────────────────────────────────────────

export interface BarPoint {
  label: string;
  value: number; // clamped to >= 0
  heightFraction: number; // 0..1, value / scaleMax
}

export interface BarLayout {
  bars: BarPoint[];
  scaleMax: number;
}

/** Non-finite points are dropped entirely; remaining values are clamped to >= 0.
 *  `scaleMax` uses the shared floor (`computeScaleMax`) so an all-zero series yields
 *  an empty track (every `heightFraction` 0), never NaN. */
export function computeBarLayout(data: readonly SeriesPoint[], maxValue?: number): BarLayout {
  const finite = data.filter((p) => Number.isFinite(p.value));
  const scaleMax = computeScaleMax(
    finite.map((p) => p.value),
    maxValue,
  );
  const bars: BarPoint[] = finite.map((p) => {
    const value = Math.max(0, p.value);
    return { label: p.label, value, heightFraction: value / scaleMax };
  });
  return { bars, scaleMax };
}

// ── line ─────────────────────────────────────────────────────────────────────

export interface LinePoint {
  label: string;
  value: number;
  xFraction: number; // 0..1, evenly spaced across the series
  yFraction: number; // 0..1, 0 = domainMin, 1 = domainMax
}

export interface LineLayout {
  points: LinePoint[];
  domainMin: number;
  domainMax: number;
}

/** Non-finite points are dropped entirely; remaining values are NOT clamped — a line
 *  scales min→max of its own finite values (D5). `maxValue`, if given, only raises
 *  `domainMax`. A degenerate (single-point or all-equal) domain has zero span, so
 *  every `yFraction`/lone `xFraction` falls back to 0.5 (a centered, visible mark)
 *  instead of dividing by zero. Empty input returns `{ points: [], domainMin: 0,
 *  domainMax: 1 }` — a placeholder-friendly, never-throwing shape. */
export function computeLineLayout(data: readonly SeriesPoint[], maxValue?: number): LineLayout {
  const finite = data.filter((p) => Number.isFinite(p.value));
  if (finite.length === 0) return { points: [], domainMin: 0, domainMax: 1 };

  let domainMin = Infinity;
  let domainMax = -Infinity;
  for (const p of finite) {
    if (p.value < domainMin) domainMin = p.value;
    if (p.value > domainMax) domainMax = p.value;
  }
  if (maxValue !== undefined && Number.isFinite(maxValue) && maxValue > domainMax) domainMax = maxValue;

  const span = domainMax - domainMin;
  const lastIndex = finite.length - 1;
  const points: LinePoint[] = finite.map((p, i) => ({
    label: p.label,
    value: p.value,
    xFraction: lastIndex === 0 ? 0.5 : i / lastIndex,
    yFraction: span === 0 ? 0.5 : (p.value - domainMin) / span,
  }));
  return { points, domainMin, domainMax };
}

// ── calendar day-index (pure integer math — never touches Date, D7) ─────────

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  return month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
}

/** Parses a strict `'YYYY-MM-DD'` string into a proleptic-Gregorian day index (days
 *  since 1970-01-01) via pure integer civil-calendar arithmetic (Howard Hinnant's
 *  `days_from_civil`) — no `Date` is ever constructed, so this is immune to host
 *  timezone/DST on every platform. Malformed strings, an out-of-range month, or a day
 *  that does not exist in that month/year (leap years honored) return `null`. */
export function dayIndexFromDate(date: string): number | null {
  const m = DATE_RE.exec(date);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Inverse of `dayIndexFromDate`: day index -> `'YYYY-MM-DD'`, same pure integer math
 *  (Howard Hinnant's `civil_from_days`). Never touches `Date`. */
export function dateFromDayIndex(dayIndex: number): string {
  const z = dayIndex + 719468;
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  const year = y + (month <= 2 ? 1 : 0);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Sunday=0 .. Saturday=6, derived from the epoch's known weekday (1970-01-01 was a
 *  Thursday) via pure modular arithmetic — never touches `Date`/`Intl`. */
export function dayOfWeekFromIndex(dayIndex: number): number {
  return ((dayIndex % 7) + 7 + 4) % 7;
}

// ── intensity ────────────────────────────────────────────────────────────────

export type IntensityBucket = 0 | 1 | 2 | 3 | 4;

/** value -> a 5-step bucket (0..4). 0 is reserved for zero/non-finite/negative values;
 *  1..4 divide `(0, scaleMax]` into even quarters (`ceil(fraction * 4)`, clamped). */
export function computeIntensityBucket(value: number, scaleMax: number): IntensityBucket {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const safeMax = scaleMax > 0 ? scaleMax : 1;
  const fraction = Math.min(1, value / safeMax);
  return Math.min(4, Math.max(1, Math.ceil(fraction * 4))) as IntensityBucket;
}

export interface IntensityRampColors {
  tone: string; // resolved ChartTone color, e.g. theme.colors.primary
  surface: string; // theme.colors.surface
  border: string; // theme.colors.border
}

const INTENSITY_STEP_OPACITY: Record<1 | 2 | 3 | 4, number> = { 1: 0.25, 2: 0.5, 3: 0.75, 4: 1 };
const ZERO_TINT_OPACITY = 0.4;
const HEX_RE = /^#([0-9a-f]{6})$/i;

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = HEX_RE.exec(hex);
  if (!m) return null;
  const digits = m[1];
  return {
    r: parseInt(digits.slice(0, 2), 16),
    g: parseInt(digits.slice(2, 4), 16),
    b: parseInt(digits.slice(4, 6), 16),
  };
}

function toHexByte(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

function compositeHexOverSurface(fgHex: string, surfaceHex: string, alpha: number): string {
  const fg = parseHex(fgHex);
  const bg = parseHex(surfaceHex);
  if (!fg || !bg) return surfaceHex; // never throw on a malformed hex — fall back to surface
  const a = Math.max(0, Math.min(1, alpha));
  return `#${toHexByte(fg.r * a + bg.r * (1 - a))}${toHexByte(fg.g * a + bg.g * (1 - a))}${toHexByte(
    fg.b * a + bg.b * (1 - a),
  )}`;
}

/** bucket 1..4 -> `tone` alpha-composited over `surface` at a stepped opacity
 *  (25/50/75/100%, D4); bucket 0 -> `border` composited over `surface` at a fixed low
 *  opacity (a neutral tint — the same fill for zero-value and unsupplied cells).
 *  Malformed hex input never throws: falls back to `surface` verbatim. */
export function intensityFill(bucket: IntensityBucket, colors: IntensityRampColors): string {
  if (bucket === 0) return compositeHexOverSurface(colors.border, colors.surface, ZERO_TINT_OPACITY);
  return compositeHexOverSurface(colors.tone, colors.surface, INTENSITY_STEP_OPACITY[bucket]);
}

// ── calendar grid ────────────────────────────────────────────────────────────

export interface CalendarCell {
  date: string; // 'YYYY-MM-DD'
  weekIndex: number; // 0..weeks-1, column (oldest first)
  dayOfWeek: number; // 0 (Sun) .. 6 (Sat), row
  value: number | null; // null = no supplied data for this day
  bucket: IntensityBucket;
}

export interface CalendarGrid {
  weeks: number; // resolved/clamped column count
  cells: CalendarCell[][]; // cells[weekIndex][dayOfWeek], 7 rows per column
  scaleMax: number;
}

const DEFAULT_WEEKS = 12;
const MIN_WEEKS = 1;
const MAX_WEEKS = 53;

function resolveWeeks(weeks: number | undefined): number {
  if (weeks === undefined || !Number.isFinite(weeks)) return DEFAULT_WEEKS;
  return Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, Math.trunc(weeks)));
}

/** Valid, clamped-to->=0 day values keyed by day index — malformed dates and
 *  non-finite values are dropped entirely (that day renders unsupplied later). */
function buildDayIndexMap(data: readonly DayPoint[]): Map<number, number> {
  const byDayIndex = new Map<number, number>();
  for (const p of data) {
    if (!Number.isFinite(p.value)) continue;
    const idx = dayIndexFromDate(p.date);
    if (idx === null) continue;
    byDayIndex.set(idx, Math.max(0, p.value));
  }
  return byDayIndex;
}

/** The anchor day index: an explicit, parseable `endDate` wins; else the latest key in
 *  `byDayIndex`; else day-index 0 (empty/all-invalid data — never throws). */
function resolveAnchor(byDayIndex: ReadonlyMap<number, number>, endDate: string | undefined): number {
  const explicit = endDate !== undefined ? dayIndexFromDate(endDate) : null;
  if (explicit !== null) return explicit;
  let anchor = 0;
  for (const idx of byDayIndex.keys()) if (idx > anchor) anchor = idx;
  return anchor;
}

/** Buckets `{date, value}` day points into a Sunday-aligned week-column grid.
 *  `weeks` defaults to 12 and clamps to `[1, 53]`. The grid's last column is the
 *  calendar week containing `endDate` (an explicit `'YYYY-MM-DD'` anchor — this
 *  module never reads the wall clock, so a caller owns "today"); when `endDate` is
 *  omitted or unparseable, the anchor falls back to the latest valid date present in
 *  `data`, or day-index 0 for empty/all-invalid data. Malformed dates and non-finite
 *  values are dropped (that day renders unsupplied); negative values clamp to 0.
 *  Every day in the window gets a cell — unsupplied days have `value: null`,
 *  `bucket: 0` (the same neutral fill as a supplied zero). Never throws. */
export function computeCalendarGrid(
  data: readonly DayPoint[],
  opts?: { weeks?: number; endDate?: string; maxValue?: number },
): CalendarGrid {
  const weeks = resolveWeeks(opts?.weeks);
  const byDayIndex = buildDayIndexMap(data);
  const anchor = resolveAnchor(byDayIndex, opts?.endDate);

  const anchorWeekStart = anchor - dayOfWeekFromIndex(anchor); // that week's Sunday
  const gridStart = anchorWeekStart - 7 * (weeks - 1);
  const scaleMax = computeScaleMax(Array.from(byDayIndex.values()), opts?.maxValue);

  const cells: CalendarCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const column: CalendarCell[] = [];
    for (let d = 0; d < 7; d++) {
      const idx = gridStart + w * 7 + d;
      const value = byDayIndex.has(idx) ? (byDayIndex.get(idx) as number) : null;
      column.push({
        date: dateFromDayIndex(idx),
        weekIndex: w,
        dayOfWeek: d,
        value,
        bucket: value === null ? 0 : computeIntensityBucket(value, scaleMax),
      });
    }
    cells.push(column);
  }
  return { weeks, cells, scaleMax };
}
