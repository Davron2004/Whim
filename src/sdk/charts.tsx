// ─────────────────────────────────────────────────────────────────────────────
// vc-sdk — the Chart component (design sdk-charts, decisions D2/D3/D4/D5).
// ─────────────────────────────────────────────────────────────────────────────
// Sibling module to `index.tsx` (same barrel re-export pattern as `controls.tsx`/
// `surfaces.tsx` — design D5). Same discipline: PURE display, no bridge traffic, no new
// hooks, no interactive marks (D6 — no `onPress`/`emitUiEvent`/`usePressed` anywhere in this
// file). All geometry (scaling, bucketing, calendar day math) lives in `chart-geometry.ts`
// (chain-1) — this module never reimplements it, only feeds it resolved theme colors and
// renders its output as inline SVG marks. Colors are read through `tokens.ts#color()`, which
// resolves ColorToken roles against the ACTIVE theme (theme.ts) — a theme switch re-renders
// with no app-side handling, and no new color token is introduced anywhere below (D4).
import * as React from 'react';
import { space, color, weight, textSize, textColor, FONT, TABULAR_NUMS } from './tokens';
import { RADII } from '../design/tokens';
import {
  computeBarLayout,
  computeLineLayout,
  computeCalendarGrid,
  intensityFill,
  type ChartTone,
  type SeriesPoint,
  type DayPoint,
  type LinePoint,
} from './chart-geometry';

// Re-exported verbatim (not redeclared) so the geometry seam stays single-source (chain-1's
// handoff contract) — `index.tsx` re-exports these straight through from here.
export type { ChartTone, SeriesPoint, DayPoint } from './chart-geometry';

// ── Props (design D2 — one `Chart`, not `BarChart`/`LineChart`/`Heatmap`) ────────────────
export type ChartProps =
  | { kind: 'bar' | 'line'; data: SeriesPoint[]; tone?: ChartTone; showValues?: boolean; maxValue?: number }
  | { kind: 'heatmap'; data: DayPoint[]; tone?: ChartTone; weeks?: number };

// ── Shared SVG frame ─────────────────────────────────────────────────────────────────────
// One inline `<svg>` per chart, `viewBox` coordinate system, `width: 100%`. The reserved
// height is FIXED regardless of container width (never a collapse for empty data) and is
// built from the space scale (`xl`) rather than a bespoke magic number, so it tracks the
// rest of the design system if that scale ever changes.
const FRAME_HEIGHT = `calc(${space('xl')} * 5)`; // 160px in the current SPACE scale

// Abstract viewBox coordinate space every chart kind plots into; `preserveAspectRatio: 'none'`
// stretches both axes independently to fill the frame's actual (fluid-width, fixed-height) box
// — the only way to honor "100% width, reserved height" simultaneously with a single SVG.
const VIEW_W = 100;
const VIEW_H = 50;
const PAD_X = 4;
const PAD_TOP = 8;
const PAD_BOTTOM = 10;
const VALUE_FONT_SIZE = 4.5;
const LINE_STROKE_PX = 2.5;

// A bar chart is HTML, not SVG: the plot stretches to the frame (`preserveAspectRatio: 'none'`
// below), which would turn a bar's rounded top into an ellipse and stretch its value label. In HTML
// each bar keeps r-xs top corners and every label its own shape; the category labels sit in equal
// slots under the bars and the browser cuts each one to its slot with an ellipsis.
const LABEL_GUTTER = `calc(${space('xs')} / 2)`;
/** Room above the tallest bar for its value label, when values show. */
const VALUE_ROOM = '22px';
/** Gridlines at the baseline, half and full scale. */
const GRID_FRACTIONS = [0, 0.5, 1];

function ChartFrame({ children }: { children: React.ReactNode }) {
  return React.createElement(
    'div',
    { style: { boxSizing: 'border-box', width: '100%', height: FRAME_HEIGHT } },
    children,
  );
}

function svgFrame(children: React.ReactNode[]) {
  return React.createElement(
    'svg',
    {
      viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
      preserveAspectRatio: 'none',
      style: { width: '100%', height: '100%', display: 'block' },
    },
    ...children,
  );
}

// The empty-data placeholder (spec "Degenerate data renders safely"): renders inside the
// SAME reserved frame height as a populated chart — never a collapse, never a throw.
function placeholderContent() {
  return React.createElement(
    'div',
    {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
    },
    React.createElement(
      'span',
      {
        style: {
          fontSize: textSize('body').size,
          lineHeight: textSize('body').line,
          fontWeight: weight(textSize('body').weight),
          color: textColor('text-muted'),
        },
      },
      'No data yet',
    ),
  );
}

// ── Bar (task 2.2) ───────────────────────────────────────────────────────────────────────
/** The footnote-size, `text-muted`, tabular style of every chart label. */
function chartLabelStyle(): Record<string, unknown> {
  const caption = textSize('caption');
  return {
    fontFamily: FONT,
    fontSize: caption.size,
    lineHeight: caption.line,
    color: textColor('text-muted'),
    ...TABULAR_NUMS,
  };
}

function gridline(fraction: number, key: string): React.ReactElement {
  return React.createElement('div', {
    key,
    style: { position: 'absolute', left: 0, right: 0, bottom: `${fraction * 100}%`, height: '1px', background: color('separator') },
  });
}

function renderBarChart(data: SeriesPoint[], tone: ChartTone, showValues: boolean, maxValue?: number) {
  const { bars } = computeBarLayout(data, maxValue);
  const toneColor = color(tone);
  const label = chartLabelStyle();
  const slot = (child: React.ReactNode, key: string, extra: Record<string, unknown> = {}) =>
    React.createElement(
      'div',
      { key, style: { flex: '1 1 0', minWidth: 0, paddingLeft: LABEL_GUTTER, paddingRight: LABEL_GUTTER, ...extra } },
      child,
    );

  const columns = bars.map((bar, i) =>
    slot(
      React.createElement(
        'div',
        {
          style: {
            position: 'relative',
            width: '60%',
            height: `${bar.heightFraction * 100}%`,
            margin: '0 auto',
            background: toneColor,
            borderRadius: `${RADII.xs.radius}px ${RADII.xs.radius}px 0 0`,
          },
        },
        showValues
          ? React.createElement(
              'span',
              {
                style: {
                  ...label,
                  position: 'absolute',
                  bottom: '100%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  paddingBottom: '2px',
                  whiteSpace: 'nowrap',
                  color: textColor('text'),
                },
              },
              String(bar.value),
            )
          : null,
      ),
      `bar-${i}`,
      { height: '100%', display: 'flex', alignItems: 'flex-end' },
    ),
  );
  const labels = bars.map((bar, i) =>
    slot(bar.label, `label-${i}`, { ...label, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }),
  );

  return React.createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', width: '100%', height: '100%' } },
    React.createElement(
      'div',
      { style: { position: 'relative', flex: '1 1 0', minHeight: 0, paddingTop: showValues ? VALUE_ROOM : space('xs') } },
      React.createElement(
        'div',
        { style: { position: 'relative', height: '100%', display: 'flex', alignItems: 'flex-end' } },
        ...GRID_FRACTIONS.map((f) => gridline(f, `grid-${f}`)),
        ...columns,
      ),
    ),
    React.createElement('div', { style: { display: 'flex', flexShrink: 0, paddingTop: space('xs') } }, ...labels),
  );
}

// ── Line (task 2.3) ──────────────────────────────────────────────────────────────────────
function renderLineChart(data: SeriesPoint[], tone: ChartTone, showValues: boolean, maxValue?: number) {
  const { points } = computeLineLayout(data, maxValue);
  const toneColor = color(tone);
  const valueColor = textColor('text');

  const plotWidth = VIEW_W - PAD_X * 2;
  const plotHeight = VIEW_H - PAD_TOP - PAD_BOTTOM;
  const toXY = (p: LinePoint) => ({
    x: PAD_X + p.xFraction * plotWidth,
    y: PAD_TOP + (1 - p.yFraction) * plotHeight,
  });
  const coords = points.map(toXY);

  const marks: React.ReactNode[] = GRID_FRACTIONS.map((f) => {
    const y = PAD_TOP + (1 - f) * plotHeight;
    return React.createElement('line', {
      key: `grid-${f}`,
      x1: PAD_X,
      x2: VIEW_W - PAD_X,
      y1: y,
      y2: y,
      stroke: color('separator'),
      strokeWidth: 1,
      vectorEffect: 'non-scaling-stroke',
    });
  });
  if (coords.length > 0) {
    marks.push(
      React.createElement('polyline', {
        key: 'line',
        points: coords.map((c) => `${c.x},${c.y}`).join(' '),
        fill: 'none',
        stroke: toneColor,
        // In screen pixels, whatever the frame's aspect (the viewBox is stretched to fit).
        strokeWidth: LINE_STROKE_PX,
        vectorEffect: 'non-scaling-stroke',
        strokeLinejoin: 'round',
        strokeLinecap: 'round',
      }),
    );
  }
  points.forEach((p, i) => {
    const { x, y } = coords[i];
    if (i === 0 || i === points.length - 1) {
      marks.push(
        React.createElement('circle', { key: `mark-${i}`, cx: x, cy: y, r: 1.8, fill: toneColor }),
      );
    }
    if (showValues) {
      marks.push(
        React.createElement(
          'text',
          {
            key: `value-${i}`,
            x,
            y: y - 2.5,
            fontSize: VALUE_FONT_SIZE,
            textAnchor: 'middle',
            fill: valueColor,
            style: { fontFamily: FONT, ...TABULAR_NUMS },
          },
          String(p.value),
        ),
      );
    }
  });

  return svgFrame(marks);
}

// ── Heatmap (task 2.4) ───────────────────────────────────────────────────────────────────
// `weeks` is passed through WITHOUT `endDate` (design sdk-charts D7 / chart-geometry contract
// — this module never reads the wall clock): the grid anchors to the latest valid date
// present in `data`, never `Date.now()`.
const HEATMAP_PAD = 3;
const HEATMAP_GAP = 0.6;

function renderHeatmap(data: DayPoint[], tone: ChartTone, weeks: number | undefined) {
  const grid = computeCalendarGrid(data, { weeks });
  const rampColors = { tone: color(tone), surface: color('surface'), border: color('border') };

  const plotWidth = VIEW_W - HEATMAP_PAD * 2;
  const plotHeight = VIEW_H - HEATMAP_PAD * 2;
  const cellW = grid.weeks > 0 ? plotWidth / grid.weeks : 0;
  const cellH = plotHeight / 7;

  const marks: React.ReactNode[] = [];
  for (let w = 0; w < grid.weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const cell = grid.cells[w][d];
      marks.push(
        React.createElement('rect', {
          key: `${w}-${d}`,
          x: HEATMAP_PAD + w * cellW + HEATMAP_GAP / 2,
          y: HEATMAP_PAD + d * cellH + HEATMAP_GAP / 2,
          width: Math.max(0, cellW - HEATMAP_GAP),
          height: Math.max(0, cellH - HEATMAP_GAP),
          fill: intensityFill(cell.bucket, rampColors),
        }),
      );
    }
  }

  return svgFrame(marks);
}

// ── The one export (design D2 / task 2.5) ────────────────────────────────────────────────
export function Chart(props: ChartProps) {
  const tone = props.tone ?? 'primary';
  if (props.data.length === 0) {
    return React.createElement(ChartFrame, null, placeholderContent());
  }
  // `switch` (rather than cascading `if`/`else if`) is load-bearing here, not stylistic: TS
  // only narrows this union's `kind: 'bar' | 'line'` combined-literal variant correctly
  // through a `switch` — chained equality checks leave the `heatmap` branch unnarrowed.
  switch (props.kind) {
    case 'bar':
      return React.createElement(
        ChartFrame,
        null,
        renderBarChart(props.data, tone, props.showValues ?? false, props.maxValue),
      );
    case 'line':
      return React.createElement(
        ChartFrame,
        null,
        renderLineChart(props.data, tone, props.showValues ?? false, props.maxValue),
      );
    case 'heatmap':
      return React.createElement(ChartFrame, null, renderHeatmap(props.data, tone, props.weeks));
  }
}
