// Node acceptance suite for chart geometry (design sdk-charts, decisions D2/D4/D5/D7).
// Auto-discovered by `src/sdk/test/run.mjs` (every `*.acceptance.ts(x)` under this
// directory) — no shared harness import, following the `list.acceptance.tsx` /
// `navigation.acceptance.tsx` idiom of local `fail`/`equal`/`deepEqual` helpers.
import {
  computeScaleMax,
  computeBarLayout,
  computeLineLayout,
  computeIntensityBucket,
  intensityFill,
  computeCalendarGrid,
  dayIndexFromDate,
  dateFromDayIndex,
  dayOfWeekFromIndex,
  type SeriesPoint,
  type DayPoint,
} from '../chart-geometry';

function fail(message: string): never {
  throw new Error(message);
}

function describe(value: unknown): string {
  return JSON.stringify(value);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) fail(`${message} (expected ${describe(expected)}, received ${describe(actual)})`);
}

function deepEqual(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) fail(`${message} (expected ${e}, received ${a})`);
}

function ok(condition: boolean, message: string): void {
  if (!condition) fail(message);
}

// Node-only global, accessed without depending on `@types/node` (this file type-checks under
// the RN root tsconfig, which has no node lib) — same cast-through-a-local-interface idiom
// `navigation.acceptance.tsx` uses for its `globalThis.window` mock.
const nodeProcess = (globalThis as { process?: { env: Record<string, string | undefined> } }).process;

// ── computeScaleMax ───────────────────────────────────────────────────────────

equal(computeScaleMax([]), 1, 'scaleMax: empty values -> floor of 1');
equal(computeScaleMax([0, 0, 0]), 1, 'scaleMax: all-zero -> floor of 1');
equal(computeScaleMax([-5, -1]), 1, 'scaleMax: all-negative clamps to 0, floor of 1');
equal(computeScaleMax([3, 7, 2]), 7, 'scaleMax: plain data max');
equal(computeScaleMax([3, 7, 2], 20), 20, 'scaleMax: maxValue raises the scale above data max');
equal(computeScaleMax([3, 7, 2], 4), 7, 'scaleMax: maxValue below data max never lowers it');
equal(computeScaleMax([NaN, Infinity, -Infinity, 5]), 5, 'scaleMax: non-finite values ignored');

// ── computeBarLayout ──────────────────────────────────────────────────────────

{
  const empty = computeBarLayout([]);
  deepEqual(empty.bars, [], 'bar: empty data -> no bars');
  equal(empty.scaleMax, 1, 'bar: empty data -> scaleMax floor of 1');
}

{
  const single: SeriesPoint[] = [{ label: 'a', value: 4 }];
  const layout = computeBarLayout(single);
  equal(layout.bars.length, 1, 'bar: single point -> one bar');
  equal(layout.bars[0].heightFraction, 1, 'bar: single point fills the track');
}

{
  // "all-zero bar values -> an empty track (no NaN)"
  const zeros: SeriesPoint[] = [
    { label: 'a', value: 0 },
    { label: 'b', value: 0 },
  ];
  const layout = computeBarLayout(zeros);
  equal(layout.scaleMax, 1, 'bar: all-zero -> scaleMax floor of 1, no divide-by-zero');
  for (const bar of layout.bars) {
    ok(!Number.isNaN(bar.heightFraction), 'bar: all-zero heightFraction is never NaN');
    equal(bar.heightFraction, 0, 'bar: all-zero heightFraction is 0 (empty track)');
  }
}

{
  const allEqual: SeriesPoint[] = [
    { label: 'a', value: 3 },
    { label: 'b', value: 3 },
    { label: 'c', value: 3 },
  ];
  const layout = computeBarLayout(allEqual);
  equal(layout.scaleMax, 3, 'bar: all-equal -> scaleMax is the shared value');
  for (const bar of layout.bars) equal(bar.heightFraction, 1, 'bar: all-equal fills the track');
}

{
  const negative: SeriesPoint[] = [
    { label: 'a', value: -5 },
    { label: 'b', value: 10 },
  ];
  const layout = computeBarLayout(negative);
  equal(layout.bars[0].value, 0, 'bar: negative value clamps to 0');
  equal(layout.bars[1].value, 10, 'bar: positive value untouched');
}

{
  const nonFinite: SeriesPoint[] = [
    { label: 'a', value: NaN },
    { label: 'b', value: Infinity },
    { label: 'c', value: -Infinity },
    { label: 'd', value: 5 },
  ];
  const layout = computeBarLayout(nonFinite);
  equal(layout.bars.length, 1, 'bar: non-finite points are dropped entirely');
  equal(layout.bars[0].label, 'd', 'bar: the one finite point survives');
}

// ── computeLineLayout ─────────────────────────────────────────────────────────

{
  const empty = computeLineLayout([]);
  deepEqual(empty.points, [], 'line: empty data -> no points');
  equal(empty.domainMin, 0, 'line: empty data -> domainMin 0');
  equal(empty.domainMax, 1, 'line: empty data -> domainMax 1 (never divides by zero)');
}

{
  // "single-point line -> one visible mark"
  const single: SeriesPoint[] = [{ label: 'a', value: 42 }];
  const layout = computeLineLayout(single);
  equal(layout.points.length, 1, 'line: single point -> one point');
  ok(!Number.isNaN(layout.points[0].xFraction), 'line: single point xFraction is never NaN');
  ok(!Number.isNaN(layout.points[0].yFraction), 'line: single point yFraction is never NaN');
  equal(layout.points[0].xFraction, 0.5, 'line: single point is centered horizontally');
  equal(layout.points[0].yFraction, 0.5, 'line: single point is centered vertically (a visible mark)');
}

{
  const allEqual: SeriesPoint[] = [
    { label: 'a', value: 7 },
    { label: 'b', value: 7 },
    { label: 'c', value: 7 },
  ];
  const layout = computeLineLayout(allEqual);
  equal(layout.domainMin, 7, 'line: all-equal domainMin');
  equal(layout.domainMax, 7, 'line: all-equal domainMax');
  for (const p of layout.points) {
    ok(!Number.isNaN(p.yFraction), 'line: all-equal yFraction is never NaN (zero span)');
    equal(p.yFraction, 0.5, 'line: all-equal yFraction falls back to centered');
  }
  deepEqual(
    layout.points.map((p) => p.xFraction),
    [0, 0.5, 1],
    'line: xFraction is evenly spaced across the series',
  );
}

{
  // negative values are NOT clamped for line (min→max scaling)
  const negative: SeriesPoint[] = [
    { label: 'a', value: -10 },
    { label: 'b', value: 10 },
  ];
  const layout = computeLineLayout(negative);
  equal(layout.domainMin, -10, 'line: negative values survive uncalmped');
  equal(layout.points[0].yFraction, 0, 'line: domain min maps to yFraction 0');
  equal(layout.points[1].yFraction, 1, 'line: domain max maps to yFraction 1');
}

{
  const nonFinite: SeriesPoint[] = [
    { label: 'a', value: NaN },
    { label: 'b', value: 1 },
    { label: 'c', value: Infinity },
    { label: 'd', value: 5 },
  ];
  const layout = computeLineLayout(nonFinite);
  equal(layout.points.length, 2, 'line: non-finite points are dropped entirely');
  deepEqual(
    layout.points.map((p) => p.label),
    ['b', 'd'],
    'line: only finite points survive, in order',
  );
}

{
  const data: SeriesPoint[] = [
    { label: 'a', value: 1 },
    { label: 'b', value: 3 },
  ];
  equal(computeLineLayout(data, 10).domainMax, 10, 'line: maxValue raises domainMax above data max');
  equal(computeLineLayout(data, 2).domainMax, 3, 'line: maxValue below data max never lowers it');
}

// ── day-index calendar math (pure integer arithmetic, no Date — D7) ──────────

equal(dayIndexFromDate('1970-01-01'), 0, 'dayIndex: epoch is day 0');
equal(dayIndexFromDate('1970-01-02'), 1, 'dayIndex: epoch + 1 day');
equal(dayIndexFromDate('1969-12-31'), -1, 'dayIndex: epoch - 1 day (pre-epoch)');

equal(dayIndexFromDate('2024-02-30'), null, 'dayIndex: Feb 30 does not exist -> null');
equal(dayIndexFromDate('2023-02-29'), null, 'dayIndex: Feb 29 in a non-leap year -> null');
ok(dayIndexFromDate('2024-02-29') !== null, 'dayIndex: Feb 29 in a leap year is valid');
equal(dayIndexFromDate('2024-13-01'), null, 'dayIndex: month 13 -> null');
equal(dayIndexFromDate('2024-00-01'), null, 'dayIndex: month 0 -> null');
equal(dayIndexFromDate('not-a-date'), null, 'dayIndex: garbage string -> null');
equal(dayIndexFromDate('2024/01/01'), null, 'dayIndex: wrong separator -> null');
equal(dayIndexFromDate('2024-1-1'), null, 'dayIndex: unpadded month/day -> null (strict shape)');

// round-trip across DST-transition dates, a leap day, and year boundaries, regardless of
// which side of any real-world DST edge the date falls on (none of this touches Date).
const roundTripDates = [
  '1969-12-31',
  '1970-01-01',
  '2023-12-31',
  '2024-01-01', // year boundary
  '2024-02-29', // leap day
  '2024-03-10', // US DST spring-forward
  '2024-11-03', // US DST fall-back
  '2000-02-29', // century leap year
  '1900-01-01', // 1900 is NOT a leap year (divisible by 100, not 400)
];
for (const date of roundTripDates) {
  const idx = dayIndexFromDate(date);
  ok(idx !== null, `dayIndex: ${date} parses`);
  equal(dateFromDayIndex(idx as number), date, `dayIndex round-trip: ${date}`);
}

// Known real-world weekdays (Sunday=0..Saturday=6) — cross-checked against the calendar,
// not just self-consistency, and independent of the machine's local timezone.
const knownWeekdays: Array<[string, number]> = [
  ['1970-01-01', 4], // Thursday
  ['2023-12-31', 0], // Sunday
  ['2024-01-01', 1], // Monday
  ['2024-02-29', 4], // Thursday
  ['2024-03-10', 0], // Sunday — US DST spring-forward
  ['2024-11-03', 0], // Sunday — US DST fall-back
];
for (const [date, expectedDow] of knownWeekdays) {
  const idx = dayIndexFromDate(date) as number;
  equal(dayOfWeekFromIndex(idx), expectedDow, `dayOfWeek: ${date}`);
}

// TZ immunity: the same dates must bucket to the same day-index/day-of-week no matter what
// the host process's local timezone is (D7 — never touches Date/Intl).
if (nodeProcess) {
  const originalTz = nodeProcess.env.TZ;
  const tzCandidates = ['UTC', 'America/New_York', 'Pacific/Kiritimati', 'Asia/Kathmandu'];
  const baseline = roundTripDates.map((d) => [dayIndexFromDate(d), dayOfWeekFromIndex(dayIndexFromDate(d) as number)]);
  try {
    for (const tz of tzCandidates) {
      nodeProcess.env.TZ = tz;
      const observed = roundTripDates.map((d) => [
        dayIndexFromDate(d),
        dayOfWeekFromIndex(dayIndexFromDate(d) as number),
      ]);
      deepEqual(observed, baseline, `dayIndex/dayOfWeek unaffected by TZ=${tz}`);
    }
  } finally {
    if (originalTz === undefined) delete nodeProcess.env.TZ;
    else nodeProcess.env.TZ = originalTz;
  }
} else {
  fail('expected a Node `process` global for the TZ-immunity check');
}

// ── computeIntensityBucket ────────────────────────────────────────────────────

equal(computeIntensityBucket(0, 10), 0, 'bucket: zero value -> bucket 0');
equal(computeIntensityBucket(-5, 10), 0, 'bucket: negative value -> bucket 0');
equal(computeIntensityBucket(NaN, 10), 0, 'bucket: NaN -> bucket 0');
equal(computeIntensityBucket(Infinity, 10), 0, 'bucket: Infinity -> bucket 0');
equal(computeIntensityBucket(2.5, 10), 1, 'bucket: low fraction -> bucket 1');
equal(computeIntensityBucket(5, 10), 2, 'bucket: half -> bucket 2');
equal(computeIntensityBucket(10, 10), 4, 'bucket: exactly scaleMax -> bucket 4 (top)');
equal(computeIntensityBucket(999, 10), 4, 'bucket: value above scaleMax clamps to bucket 4');
equal(computeIntensityBucket(5, 0), 4, 'bucket: scaleMax 0 falls back to a safe max of 1, no NaN/Infinity');

// ── intensityFill ─────────────────────────────────────────────────────────────

const COLORS = { tone: '#ff0000', surface: '#000000', border: '#ffffff' };

equal(intensityFill(4, COLORS), '#ff0000', 'ramp: bucket 4 is the full tone color');
equal(intensityFill(1, COLORS), '#400000', 'ramp: bucket 1 is tone at 25% over surface');
equal(intensityFill(2, COLORS), '#800000', 'ramp: bucket 2 is tone at 50% over surface');
equal(intensityFill(3, COLORS), '#bf0000', 'ramp: bucket 3 is tone at 75% over surface');
equal(intensityFill(0, COLORS), '#666666', 'ramp: bucket 0 is border-tinted neutral over surface');
equal(
  intensityFill(0, { tone: '#ff0000', surface: '#123456', border: 'not-a-color' }),
  '#123456',
  'ramp: malformed hex never throws, falls back to surface',
);

// ── computeCalendarGrid ───────────────────────────────────────────────────────

{
  const grid = computeCalendarGrid([]);
  equal(grid.weeks, 12, 'grid: weeks defaults to 12');
  equal(grid.cells.length, 12, 'grid: one column per week');
  for (const column of grid.cells) {
    equal(column.length, 7, 'grid: 7 rows per column');
    for (const cell of column) {
      equal(cell.value, null, 'grid: unsupplied day has value null');
      equal(cell.bucket, 0, 'grid: unsupplied day is a neutral bucket-0 cell');
    }
  }
}

for (const [weeksIn, weeksOut] of [
  [0, 1],
  [-5, 1],
  [1, 1],
  [53, 53],
  [100, 53],
  [NaN, 12],
] as const) {
  equal(computeCalendarGrid([], { weeks: weeksIn }).weeks, weeksOut, `grid: weeks ${weeksIn} clamps to ${weeksOut}`);
}

{
  // A single supplied day lands in the correct cell, at the correct bucket, anchored to an
  // explicit endDate (this module never reads the wall clock).
  const data: DayPoint[] = [{ date: '2024-03-10', value: 10 }]; // Sunday, DST spring-forward
  const grid = computeCalendarGrid(data, { weeks: 4, endDate: '2024-03-10' });
  equal(grid.scaleMax, 10, 'grid: scaleMax reflects the one supplied value');
  const lastColumn = grid.cells[grid.cells.length - 1];
  const sundayCell = lastColumn[0];
  equal(sundayCell.date, '2024-03-10', 'grid: the anchor date lands on the last column, Sunday row');
  equal(sundayCell.value, 10, 'grid: supplied value round-trips onto its cell');
  equal(sundayCell.bucket, 4, 'grid: max-of-scale value buckets to 4');
  for (const column of grid.cells) {
    for (const cell of column) {
      if (cell.date === '2024-03-10') continue;
      equal(cell.value, null, 'grid: every other cell is unsupplied');
    }
  }
}

{
  // Negative clamps to 0 (bucket 0), non-finite and malformed dates are dropped, never throw.
  const data: DayPoint[] = [
    { date: '2024-11-03', value: -5 }, // Sunday, DST fall-back — clamps to 0
    { date: '2024-11-04', value: NaN }, // dropped
    { date: '2024-02-30', value: 7 }, // malformed date — dropped
    { date: 'garbage', value: 3 }, // malformed date — dropped
  ];
  const grid = computeCalendarGrid(data, { weeks: 2, endDate: '2024-11-03' });
  equal(grid.scaleMax, 1, 'grid: no valid positive values -> scaleMax floor of 1');
  const anchorColumn = grid.cells[grid.cells.length - 1];
  equal(anchorColumn[0].date, '2024-11-03', 'grid: anchor date on the Sunday row');
  equal(anchorColumn[0].value, 0, 'grid: negative value clamps to 0');
  equal(anchorColumn[0].bucket, 0, 'grid: clamped-zero value is bucket 0');
}

{
  // Year boundary: a grid whose window straddles Dec 31 -> Jan 1 buckets both days correctly.
  const data: DayPoint[] = [
    { date: '2023-12-31', value: 5 },
    { date: '2024-01-01', value: 8 },
  ];
  const grid = computeCalendarGrid(data, { weeks: 2, endDate: '2024-01-01' });
  const flat = grid.cells.flat();
  const dec31 = flat.find((c) => c.date === '2023-12-31');
  const jan1 = flat.find((c) => c.date === '2024-01-01');
  ok(dec31 !== undefined, 'grid: Dec 31 is inside the window');
  ok(jan1 !== undefined, 'grid: Jan 1 is inside the window');
  equal(dec31?.value, 5, 'grid: Dec 31 value present');
  equal(jan1?.value, 8, 'grid: Jan 1 value present');
  equal(dec31?.dayOfWeek, 0, 'grid: Dec 31 2023 is a Sunday');
  equal(jan1?.dayOfWeek, 1, 'grid: Jan 1 2024 is a Monday');
}

{
  // No endDate and no data -> anchors to day-index 0 without throwing.
  const grid = computeCalendarGrid([], { weeks: 1 });
  equal(grid.weeks, 1, 'grid: empty data + no endDate resolves a 1-week grid');
  equal(grid.cells[0].length, 7, 'grid: still a full 7-row column');
}

console.log('SDK chart-geometry acceptance: PASS');
