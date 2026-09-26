/**
 * tile-colour Node suite (shell-redesign-v2 chain-F, task F6). Exercises the one path every
 * surface resolves an app's tile colour through: `tiles.ts#tileColor` (declared-colour-wins with
 * a deterministic fallback) and `manifest-tile-color.ts#liftManifestTileColor` (the wire ->
 * host-record lift, no re-validation), and the home grid cell width. How a rendered tile paints its
 * colour is in `home-grid-ui.suite.tsx`.
 */

import { Harness } from './harness';
import { tileColor } from '../tiles';
import { liftManifestTileColor } from '../manifest-tile-color';
import {
  HOME_GRID_COLUMNS,
  HOME_GRID_COLUMN_GAP,
  HOME_GRID_SIDE_PADDING,
  homeGridCellWidth,
} from '../home-grid';
import { appColor, STATUS_COLORS, STATUS_COLORS_ON_INK, SHELL_COLORS } from '../../../sdk/theme';
import { lexProse } from '../../ui/whim-prose/lex';
import type { AppManifest } from '../../bridge/contract';
import { APP_RECORDS } from '../../../runtime/generated/app-records';

/** How far apart (degrees of hue) any two seeded example tiles must be: an eighth of the wheel. */
const MIN_SEEDED_HUE_DISTANCE = 45;

/** A `#rrggbb` colour's HSL hue in degrees, [0, 360). */
function hueOf(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 0;
  let sector: number;
  if (max === r) sector = ((g - b) / delta + 6) % 6;
  else if (max === g) sector = (b - r) / delta + 2;
  else sector = (r - g) / delta + 4;
  return sector * 60;
}

export async function runTileColourTests(h: Harness): Promise<void> {
  const VALID = '#2f6feb'; // a legible hex outside the reserved set, arbitrary for these checks

  // ── tileColor — declared colour wins ──────────────────────────────────────
  await h.test('tileColor: a valid declared colour wins over appColor', async () => {
    const manifest: Pick<AppManifest, 'tileColor'> = { tileColor: VALID };
    h.eq(tileColor('Pour Timer', manifest), VALID, 'declared colour is returned verbatim');
  });

  await h.test('tileColor: declared colour comparison against reserved hues is case-insensitive', async () => {
    const manifest: Pick<AppManifest, 'tileColor'> = { tileColor: VALID.toUpperCase() };
    h.eq(tileColor('Pour Timer', manifest), VALID.toUpperCase(), 'uppercase hex still wins when not reserved');
  });

  // ── malformed / reserved-hue declarations fall back ───────────────────────
  await h.test('tileColor: a malformed declared colour falls back to appColor(name)', async () => {
    const malformed = ['not-a-hex', '#zzzzzz', '#fff', 'ffaa00', '#12345', ''];
    for (const bad of malformed) {
      const manifest: Pick<AppManifest, 'tileColor'> = { tileColor: bad };
      h.eq(tileColor('Water Counter', manifest), appColor('Water Counter'), `"${bad}" falls back to appColor`);
    }
  });

  await h.test('tileColor: a reserved status/shell hue falls back to appColor(name)', async () => {
    const reserved = [
      STATUS_COLORS.working,
      STATUS_COLORS.broken,
      STATUS_COLORS.waiting,
      STATUS_COLORS_ON_INK.working,
      STATUS_COLORS_ON_INK.broken,
      SHELL_COLORS.accent,
      SHELL_COLORS.yours,
      SHELL_COLORS.yoursOnDark,
      STATUS_COLORS.working.toUpperCase(), // reservation must be case-insensitive
    ];
    for (const hue of reserved) {
      const manifest: Pick<AppManifest, 'tileColor'> = { tileColor: hue };
      h.eq(tileColor('Habit Tracker', manifest), appColor('Habit Tracker'), `reserved hue "${hue}" falls back`);
    }
  });

  // ── no declaration resolves appColor(name) ────────────────────────────────
  await h.test('tileColor: no manifest at all resolves appColor(name)', async () => {
    h.eq(tileColor('Recipe Box'), appColor('Recipe Box'), 'omitted manifest falls back');
  });

  await h.test('tileColor: a manifest with no tileColor field resolves appColor(name)', async () => {
    h.eq(tileColor('Recipe Box', {}), appColor('Recipe Box'), 'absent field falls back');
    h.eq(tileColor('Recipe Box', { tileColor: undefined }), appColor('Recipe Box'), 'explicit undefined falls back');
  });

  await h.test('tileColor: the grid path and the prose renderer path agree for the appColor fallback', async () => {
    const gridColour = tileColor('Water Counter'); // no declared colour
    const proseApp = { name: 'Water Counter' }; // prose lexer falls back to appColor(name) itself
    const spans = lexProse('Open Water Counter now', [proseApp]);
    const appSpan = spans.find(s => s.cls === 'app');
    h.eq(appSpan?.color, gridColour, 'both paths land on the same appColor(name) fallback');
  });

  // ── liftManifestTileColor — the wire -> host-record lift, no re-validation ─
  await h.test('liftManifestTileColor: a string tileColor is lifted verbatim', async () => {
    h.eq(liftManifestTileColor({ tileColor: VALID }), { tileColor: VALID }, 'string value round-trips');
    h.eq(liftManifestTileColor({ tileColor: 'NotEvenHex' }), { tileColor: 'NotEvenHex' }, 'no re-validation performed here');
  });

  await h.test('liftManifestTileColor: a missing or non-string tileColor lifts nothing', async () => {
    h.eq(liftManifestTileColor({}), {}, 'no key at all');
    h.eq(liftManifestTileColor({ tileColor: 42 }), {}, 'a number is dropped');
    h.eq(liftManifestTileColor({ tileColor: null }), {}, 'null is dropped');
    h.eq(liftManifestTileColor({ tileColor: undefined }), {}, 'undefined is dropped');
    h.eq(liftManifestTileColor({ capabilities: ['x'] }), {}, 'an unrelated manifest key is ignored');
  });

  await h.test('liftManifestTileColor: composes with tileColor to reproduce the end-to-end fallback', async () => {
    // A reserved hue survives the lift (the server already dropped it before this point in the
    // real pipeline) but is still caught by tileColor's own validity check downstream.
    const lifted = liftManifestTileColor({ tileColor: STATUS_COLORS.broken });
    h.eq(lifted, { tileColor: STATUS_COLORS.broken }, 'lift is a straight passthrough');
    h.eq(tileColor('Budget', lifted), appColor('Budget'), 'the resolution helper still falls back');
  });

  // ── seeded examples — the shipped build output, not a re-parse of source ──
  await h.test('tileColor: the three seeded examples\' shipped records resolve to distinct declared colours', async () => {
    // `defaultSeeds()` in LauncherRoot.tsx installs these three ids on first run. Reads the real
    // producer, the generated APP_RECORDS build.mjs#extractAppRecord emits (never a hand-typed
    // hex), so a regression that drops `tileColor` on the wire from source to shipped record
    // (as build.mjs did before commit 9a79c9c9) fails this test, not just the source-level one in
    // checks/test/acceptance.ts.
    const seededIds = ['tip-splitter', 'water-counter', 'style-gallery'];
    const resolved = seededIds.map((id) => {
      const record = APP_RECORDS[id];
      h.ok(!!record, `${id}: expected a shipped app record`);
      const declared = record?.manifest.tileColor;
      h.ok(typeof declared === 'string', `${id}: expected a declared tileColor on the shipped manifest`);
      // Goes through the same resolution path every render surface uses, so a declared value that
      // the shipped manifest carries but that tileColor() would reject (malformed, or a reserved
      // shell hue) is caught here too, not just a bad/missing literal.
      return tileColor(record?.name ?? id, { tileColor: declared });
    });
    for (const [i, id] of seededIds.entries()) {
      h.eq(resolved[i], APP_RECORDS[id]?.manifest.tileColor, `${id}: the shipped declared colour is not rejected by tileColor()`);
    }
    h.eq(new Set(resolved).size, resolved.length, `expected ${resolved.length} pairwise-distinct seeded tile colours, got ${JSON.stringify(resolved)}`);
  });

  await h.test('tileColor: the seeded examples\' shipped colours sit in clearly different hue families', async () => {
    // Distinct hex is not distinct to the eye: #2563eb and #0284c7 are both "blue" side by side on
    // Home. Each pair of seeded tiles must be at least an eighth of the colour wheel apart.
    const seeded = ['tip-splitter', 'water-counter', 'style-gallery'].map((id) => {
      const record = APP_RECORDS[id];
      return { id, hue: hueOf(tileColor(record?.name ?? id, record?.manifest)) };
    });
    for (const [i, a] of seeded.entries()) {
      for (const b of seeded.slice(i + 1)) {
        const apart = Math.min(Math.abs(a.hue - b.hue), 360 - Math.abs(a.hue - b.hue));
        h.ok(apart >= MIN_SEEDED_HUE_DISTANCE, `${a.id} and ${b.id} are ${apart.toFixed(0)}° apart in hue, under ${MIN_SEEDED_HUE_DISTANCE}°`);
      }
    }
    h.eq(['#ff0000', '#ffff00', '#00ff00', '#0000ff', '#ff00ff'].map(hueOf), [0, 60, 120, 240, 300], 'the hue reading itself is the standard HSL hue');
  });

  // ── homeGridCellWidth — the fluid 3-up grid (finding V3, design html:388) ──────
  const FALLBACK = 88; // stands in for APP_TILE_SIZE, which lives in an RN module Node cannot load

  await h.test('homeGridCellWidth: the design’s 390 frame yields the 106 the mockup renders', async () => {
    // repeat(3,1fr) across 390 minus 22 either side minus two 14 gaps = 318, split three ways.
    h.eq(homeGridCellWidth(390, FALLBACK), 106, 'the mockup’s own frame reproduces the mockup’s own tile');
    h.ok(homeGridCellWidth(390, FALLBACK) > FALLBACK, 'and it is genuinely wider than the fixed 88 this replaces');
  });

  await h.test('homeGridCellWidth: a wider device gets proportionally wider tiles', async () => {
    h.eq(homeGridCellWidth(411, FALLBACK), 113, 'a 411dp Android frame divides exactly');
    h.ok(homeGridCellWidth(411, FALLBACK) > homeGridCellWidth(390, FALLBACK), 'wider frame, wider tile — the grid is fluid, not capped');
  });

  await h.test('homeGridCellWidth: a frame that does not divide evenly is FLOORED, never rounded up', async () => {
    // 412 - 44 - 28 = 340; 340/3 = 113.33... Rounding up (or leaving the fraction) can put
    // 3 tiles + 2 gaps over the row, and the grid is flexWrap:'wrap' — an overflow of any size
    // drops the third tile onto its own row. Flooring gives up <=2dp at the right edge instead.
    h.eq(homeGridCellWidth(412, FALLBACK), 113, '113.33 floors to 113');
    h.eq(homeGridCellWidth(413, FALLBACK), 113, '113.66 floors to 113 as well — never 114');
  });

  await h.test('homeGridCellWidth: three tiles plus two gaps never overflow the row, at any width', async () => {
    const gutters = 2 * HOME_GRID_SIDE_PADDING + (HOME_GRID_COLUMNS - 1) * HOME_GRID_COLUMN_GAP;
    for (let frame = 240; frame <= 1280; frame++) {
      // A DOMAIN guard, not a value guard. Skipping on `cell === FALLBACK` would excuse any
      // regression that returns the fallback for a perfectly good frame — and would silently skip
      // frame 336, where floor(264/3) legitimately equals 88 and collides with the sentinel.
      if (frame <= gutters) continue;
      const cell = homeGridCellWidth(frame, FALLBACK);
      const row = HOME_GRID_COLUMNS * cell + (HOME_GRID_COLUMNS - 1) * HOME_GRID_COLUMN_GAP;
      h.ok(row <= frame - 2 * HOME_GRID_SIDE_PADDING, `frame ${frame}: a row of ${HOME_GRID_COLUMNS} fits without wrapping`);
      h.eq(cell, Math.floor(cell), `frame ${frame}: the width is whole dp`);
    }
  });

  await h.test('homeGridCellWidth: a degenerate frame falls back, never <= 0 and never NaN', async () => {
    // 0 is what a window-dimensions read can hand back before the first layout pass; a frame
    // narrower than the chrome being subtracted makes the subtraction negative.
    //
    // 72/73/74 are the band where the division lands on exactly zero (gutters are 2*22 + 2*14 =
    // 72), which is the one case the `cell > 0` predicate exists for. Without them a `>= 0`
    // regression ships a zero-width tile and every other case here still passes.
    for (const frame of [0, -1, 40, 71, 72, 73, 74, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const cell = homeGridCellWidth(frame, FALLBACK);
      h.eq(cell, FALLBACK, `frame ${frame} falls back to the tile default`);
      h.ok(Number.isFinite(cell) && cell > 0, `frame ${frame} never yields NaN or a non-positive width`);
    }
    h.eq(homeGridCellWidth(0, 999), 999, 'the fallback returned is the caller’s, not a second hardcoded 88');
  });

  // A prior version of this suite had a test named "AppTile: exports its size constants and no
  // other module restates them" that only asserted `monogram('Pour Timer') === 'PT'` — tautological
  // against its own name. `flow-skeletons.tsx` importing `APP_TILE_SIZE`/`APP_TILE_RADIUS` and
  // using them directly (never restating a literal) is already covered by
  // `prompt-flow-screens.suite.ts` ("skeletons: geometry is imported..."), so it is deleted here
  // rather than fixed in place.
}
