/**
 * tile-colour Node suite (shell-redesign-v2 chain-F, task F6). Exercises the one path every
 * surface resolves an app's tile colour through: `tiles.ts#tileColor` (declared-colour-wins with
 * a deterministic fallback) and `manifest-tile-color.ts#liftManifestTileColor` (the wire ->
 * host-record lift, no re-validation). `AppTile` itself is an RN component (not renderable under
 * Node, same idiom as `prompt-flow-screens.suite.ts`), so its geometry/monogram-placement
 * contract is checked against its production source text instead.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
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

function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'src/host/launcher', file), 'utf8');
}

/** Source with its comments removed: a negative assertion is about what the code DOES, not about
 *  prose that happens to name the very thing being forbidden (the `prompt-flow-screens` idiom). */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** One named `StyleSheet.create` entry, brace-balanced (so a nested object value does not truncate
 *  it). Empty when the entry does not exist, which fails the assertion that wanted it. */
function styleBlock(src: string, name: string): string {
  const start = src.indexOf(`${name}: {`);
  if (start < 0) return '';
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  return '';
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

  // ── determinism ────────────────────────────────────────────────────────────
  await h.test('tileColor: deterministic — same name + manifest always resolves the same colour', async () => {
    const manifest: Pick<AppManifest, 'tileColor'> = { tileColor: VALID };
    h.eq(tileColor('Pour Timer', manifest), tileColor('Pour Timer', manifest), 'declared path is stable');
    h.eq(tileColor('Pour Timer'), tileColor('Pour Timer'), 'fallback path is stable');
  });

  // ── the bundle cannot recolour itself ─────────────────────────────────────
  await h.test('tileColor: only the manifest.tileColor key is ever read, nothing else on the object', async () => {
    // A bundle can only ever influence its OWN in-realm state; the resolver's signature has no
    // channel for a running mini-app's self-report at all — it reads the host-held manifest
    // object's `tileColor` key and nothing else, so a hostile bolt-on field is structurally inert.
    const spoofed = { tileColor: VALID, reportedByBundle: '#ff0000', __selfReport: '#00ff00' } as Pick<
      AppManifest,
      'tileColor'
    >;
    h.eq(tileColor('Pour Timer', spoofed), VALID, 'extra fields on the manifest object are ignored');
  });

  // ── grid, header and prose resolve one app to one colour ──────────────────
  await h.test('tileColor: the grid path and the prose renderer path agree for a declared colour', async () => {
    const manifest: Pick<AppManifest, 'tileColor'> = { tileColor: VALID };
    const gridColour = tileColor('Pour Timer', manifest); // what a tile/history header would render
    const proseApp = { name: 'Pour Timer', color: gridColour }; // caller pre-resolves, per ProseApp's contract
    const spans = lexProse('Open Pour Timer now', [proseApp]);
    const appSpan = spans.find(s => s.cls === 'app');
    h.ok(appSpan != null, 'prose lexes an app-class span for a mentioned installed app');
    h.eq(appSpan?.color, gridColour, 'the prose span uses the exact colour the grid resolved');
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

  // ── AppTile — production source checks (RN component, not renderable under Node) ──
  await h.test('AppTile: monogram twice, from the single tiles.ts path, at the declared geometry', async () => {
    const src = read('app-tile.tsx');
    h.ok(/import \{ monogram, tileColor \} from '\.\/tiles';/.test(src), 'imports the one colour/monogram path from tiles.ts');
    h.ok(/APP_TILE_SIZE = 88/.test(src), 'exports the 88px tile size constant');
    h.ok(/APP_TILE_RADIUS = RADIUS\.tile/.test(src), 'exports the tile-radius constant, from the shared token');
    h.ok(/ghostMonogram/.test(src) && /foregroundMonogram/.test(src), 'renders both the ghost and foreground monogram');
    h.ok(/rgba\(255,255,255,0\.16\)/.test(src), 'the bled monogram is 16% white');
    h.ok(/rgba\(255,255,255,0\.3\)/.test(src), 'the inset border is 30% white');
    h.ok(!/TILE_COLORS/.test(src), 'never restates a second name->colour mapping');
  });

  await h.test('AppTile: the grid tile stands at the design’s §2b geometry', async () => {
    const src = read('app-tile.tsx');
    h.ok(/padding: 9,/.test(styleBlock(src, 'tile')), 'the tile is padded 9 (design html:543)');
    h.ok(/top: -13,/.test(styleBlock(src, 'ghostMonogram')), 'the bled monogram sits at top -13 (design html:543)');
  });

  await h.test('AppTile: the done variant is one optional prop, and every default render is untouched by it', async () => {
    const src = read('app-tile.tsx');
    h.ok(/\bsize\?: 'done';/.test(src), 'the variant is a single OPTIONAL prop on AppTileProps, not a second component');
    h.ok(/const isDone = size === 'done';/.test(src), 'the variant is decided in one place');
    // The load-bearing guarantee: a caller that passes no `size` (the home grid) can never reach a
    // done-variant style. Each one is applied exactly once, always behind the same `isDone` gate.
    for (const variant of ['rootDone', 'tileDone', 'ghostMonogramDone', 'foregroundMonogramDone']) {
      h.eq((src.match(new RegExp(`styles\\.${variant}`, 'g')) ?? []).length, 1, `styles.${variant} is applied in exactly one place`);
      h.ok(src.includes(`isDone ? styles.${variant} : null`), `styles.${variant} is reachable only through the done variant`);
    }
    // The glow is the one done-only style that is NOT a `styles.*` entry — it is built at the call
    // site because it carries the app's resolved colour — so it needs its own gate assertion.
    h.ok(src.includes('const glow = isDone'), 'the glow is reachable only through the done variant');
    h.ok(/\{!isDone && <Text style=\{styles\.name\}/.test(src), 'the name label renders for the grid tile and never for the done tile');
  });

  await h.test('AppTile: the done variant carries the design’s 2a celebration geometry and the app’s own hue', async () => {
    const src = read('app-tile.tsx');
    // design html:520-524
    h.ok(/DONE_TILE_SIZE = 120/.test(src), 'the done tile is 120 wide');
    const tileDone = styleBlock(src, 'tileDone');
    h.ok(/width: DONE_TILE_SIZE,\s*height: DONE_TILE_SIZE,/.test(tileDone), 'and 120 tall, from the one constant');
    h.ok(/borderRadius: 32,/.test(tileDone), 'radius 32');
    h.ok(/padding: 14,/.test(tileDone), 'padded 14');
    const ghostDone = styleBlock(src, 'ghostMonogramDone');
    h.ok(/top: -20/.test(ghostDone) && /right: -12/.test(ghostDone) && /fontSize: 92/.test(ghostDone), 'the bled monogram is 92 at -20/-12');
    h.ok(/fontSize: 26/.test(styleBlock(src, 'foregroundMonogramDone')), 'the foreground monogram is 26');
    // The glow is `boxShadow`, the one shadow primitive Android honours (`shadowOffset`,
    // `shadowOpacity` and `shadowRadius` are iOS-only, and `elevation` draws Android's own default
    // profile rather than this one). Asserted as the offset/blur/alpha the design specifies.
    h.ok(/GLOW_OFFSET_Y = 8;/.test(src) && /GLOW_BLUR = 22;/.test(src), 'the glow falls 8 down over a 22 blur');
    h.ok(/GLOW_ALPHA_HEX = '4d';/.test(src), 'at 30% alpha (0.3 x 255, rounded to 0x4d)');
    h.ok(/boxShadow: \[\{ offsetX: 0, offsetY: GLOW_OFFSET_Y, blurRadius: GLOW_BLUR/.test(src), 'delivered through boxShadow, which Android renders');
    h.ok(!/shadowOpacity|shadowRadius|shadowOffset|elevation/.test(code(src)), 'never through the iOS-only shadow props or a default-profile elevation');
    // Ruling R20: the celebration tile keeps the app's identity across two adjacent screens — its
    // fill AND its glow are the app's own resolved colour, never a fixed status hue.
    h.ok(/color: `\$\{bg\}\$\{GLOW_ALPHA_HEX\}`/.test(src), 'the glow is the tile’s own resolved colour');
    h.ok(!/STATUS_COLORS/.test(code(src)), 'no fixed status hue is imported for the done tile');
    // The design's `rise` uses CSS `ease` = cubic-bezier(.25,.1,.25,1), which DECELERATES. RN's
    // `Easing.ease` is bezier(.42,0,1,1) — CSS `ease-in`, the opposite shape — so the curve is
    // spelled out rather than named, the same translation `Orb.tsx:58` makes for `sheetRise`.
    h.ok(/RISE_EASING = Easing\.bezier\(0\.25, 0\.1, 0\.25, 1\);/.test(src), 'the rise decelerates on the design’s own curve');
    h.ok(/easing: RISE_EASING,/.test(src), 'and that curve is the one the entrance actually runs on');
  });

  await h.test('DoneStep: both CTAs stand at one height, the design’s 52', async () => {
    const src = read('DoneStep.tsx');
    const height = (name: string): string => /height: ([\d.]+),/.exec(styleBlock(src, name))?.[1] ?? '';
    const primary = height('primary');
    const secondary = height('secondary');
    h.eq(primary, secondary, 'the two stacked actions are never a mismatched pair');
    h.eq(primary, '52', 'and both stand at the design’s 52 (html:527-528)');
  });

  // ── AppTile `width` — the grid dimension, orthogonal to the `done` variant (ruling R23) ──
  await h.test('AppTile: `width` is optional, and omitting it keeps the default 88 geometry', async () => {
    const src = read('app-tile.tsx');
    h.ok(/\bwidth\?: number;/.test(src), '`width` is an OPTIONAL second prop, never a widening of `size`');
    h.ok(!/size\?:[^;]*number/.test(code(src)), '`size` stays the variant selector and never also means "how wide"');
    // The guarantee L2 owed every existing caller: pass no `width` and nothing moves. 88 is
    // supplied by the default parameter, so `root`/`tile` resolve exactly what the removed
    // `width: APP_TILE_SIZE` / `height: APP_TILE_SIZE` style entries used to.
    h.ok(/width = APP_TILE_SIZE \}: Readonly<AppTileProps>/.test(src), 'the default is APP_TILE_SIZE, from the one exported constant');
    h.ok(/const fluidRoot = isDone \? null : \{ width \};/.test(src), 'the root takes its width from the prop');
    h.ok(/const fluidTile = isDone \? null : \{ width, height: width \};/.test(src), 'and the tile stays square at that width');
    // Ruling R23's stated precedence: the done tile is a fixed 120x120 preset and IGNORES `width`.
    // Both overrides are `null` there, so `rootDone`/`tileDone` remain its only geometry — the
    // outcome is decided in the code, not by where the overrides sit in the style arrays.
    h.ok(!/width: APP_TILE_SIZE/.test(code(src)), 'no style entry restates the size the prop now carries');
  });

  await h.test('HomeScreen: the grid asks for a cell width and hands the same value to the tile', async () => {
    const src = read('HomeScreen.tsx');
    h.ok(/homeGridCellWidth\(useWindowDimensions\(\)\.width, APP_TILE_SIZE\)/.test(src), 'the frame width drives the cell, falling back to the tile default');
    h.ok(/style=\{\{ width: cellWidth \}\}/.test(src), 'the grid cell is that width');
    h.ok(/<AppTile name=\{app\.name\} manifest=\{app\.record\.manifest\} width=\{cellWidth\} \/>/.test(src), 'and the tile fills it — never an 88 tile left-aligned in a wider box');
    h.ok(/paddingHorizontal: HOME_GRID_SIDE_PADDING/.test(src), 'the padding the derivation subtracts is the padding the style applies');
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
