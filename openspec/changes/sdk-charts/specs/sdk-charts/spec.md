# sdk-charts — mini-app charting surface

## ADDED Requirements

### Requirement: A single declarative Chart renders the three corpus chart kinds from plain data

The SDK SHALL export exactly one charting component, `Chart`, with `kind: 'bar' | 'line' | 'heatmap'` and data supplied as a plain array prop (`{label, value}` points for bar/line; `{date, value}` day points for heatmap). `Chart` MUST be pure rendering: usable with `capabilities: []`, no bridge traffic, no new hooks, and no interactive marks (no press handling on bars/points/cells).

#### Scenario: A bar chart renders one bar per point, scaled to the data

- **WHEN** a mini-app renders `Chart` with `kind: 'bar'` and seven `{label, value}` points
- **THEN** seven bars render with heights proportional to their values against the derived (or `maxValue`-pinned) scale, each with its label

#### Scenario: A line chart renders a trend across ordered points

- **WHEN** a mini-app renders `Chart` with `kind: 'line'` and an ordered series of `{label, value}` points
- **THEN** a single polyline connects the points in data order, scaled to the series' value range

#### Scenario: A calendar heatmap renders day cells with value-scaled intensity

- **WHEN** a mini-app renders `Chart` with `kind: 'heatmap'` and `{date, value}` day points spanning several weeks
- **THEN** a week-column calendar grid renders in which each supplied day's cell intensity reflects its value bucket and unsupplied days render as neutral cells

### Requirement: Charts are theme-derived and self-contained

Chart rendering SHALL derive every color from the active theme's existing color roles (series color from the `tone` prop's role, defaulting to `primary`; heatmap intensity as a stepped ramp of that role; neutrals from `surface`/`border`/`text-muted`) and MUST introduce no new color tokens. Rendering MUST be fully self-contained under the locked CSP: inline SVG/DOM with inline styles only — no canvas, no external images, fonts, stylesheets, or network fetches.

#### Scenario: A theme switch recolors charts with no app change

- **WHEN** the active theme changes (e.g. light to dark) while a chart is displayed
- **THEN** the chart re-renders using the new theme's role values, with no chart-specific theme handling in the mini-app's code

#### Scenario: Charts add no containment-relevant surface

- **WHEN** the sandbox-isolation and bridge invariant suites run against a build containing `Chart`
- **THEN** they pass unchanged — charts perform no network, storage, or bridge access

### Requirement: Degenerate data renders safely

`Chart` MUST NOT throw for degenerate input. Empty data SHALL render the chart's reserved frame with a muted placeholder instead of collapsing or crashing; all-zero and single-point data SHALL render with a sane scale (no division-by-zero artifacts); non-finite values are dropped; bar and heatmap values below zero are clamped to zero.

#### Scenario: An empty collection produces a placeholder, not a crash

- **WHEN** a mini-app renders any `Chart` kind with `data: []` (e.g. a fresh app whose `records.list` returned nothing)
- **THEN** the chart area renders at its reserved height with a muted "no data" placeholder, and no error is thrown

#### Scenario: All-zero and single-point data render without artifacts

- **WHEN** a bar chart receives all-zero values, or a line chart receives exactly one point
- **THEN** the chart renders an empty track (bars) or a single visible mark (line) with no thrown error and no NaN-derived geometry

### Requirement: The style gallery demonstrates every chart kind with seeded data

The style-gallery fixture SHALL include a Charts section rendering every `Chart` kind with seeded, realistic demo data (hardcoded local state, `capabilities: []`) so each chart always displays populated output, plus one empty-data chart demonstrating the placeholder behavior.

#### Scenario: The gallery shows populated charts on first launch

- **WHEN** the style gallery is launched with no user interaction
- **THEN** the Charts section displays a populated bar chart, line chart, and calendar heatmap, and an empty-data example showing the placeholder
