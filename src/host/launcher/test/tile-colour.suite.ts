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
import { appColor, STATUS_COLORS, STATUS_COLORS_ON_INK, SHELL_COLORS } from '../../../sdk/theme';
import { lexProse } from '../../ui/whim-prose/lex';
import type { AppManifest } from '../../bridge/contract';

function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'src/host/launcher', file), 'utf8');
}

/** One named `StyleSheet.create` entry, brace-balanced (so a nested `shadowOffset: { … }` does not
 *  truncate it). Empty when the entry does not exist, which fails the assertion that wanted it. */
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
    h.ok(/shadowOpacity: 0\.3,/.test(tileDone) && /shadowRadius: 22,/.test(tileDone), 'glow at 30% over a 22 blur');
    h.ok(/shadowOffset: \{ width: 0, height: 8 \},/.test(tileDone), 'offset 8 down');
    const ghostDone = styleBlock(src, 'ghostMonogramDone');
    h.ok(/top: -20/.test(ghostDone) && /right: -12/.test(ghostDone) && /fontSize: 92/.test(ghostDone), 'the bled monogram is 92 at -20/-12');
    h.ok(/fontSize: 26/.test(styleBlock(src, 'foregroundMonogramDone')), 'the foreground monogram is 26');
    // Ruling R20: the celebration tile keeps the app's identity across two adjacent screens — its
    // fill AND its glow are the app's own resolved colour, never a fixed status hue.
    h.ok(/shadowColor: bg/.test(src), 'the glow is colour-matched to the tile’s own resolved colour');
    h.ok(!/STATUS_COLORS/.test(src), 'no fixed status hue is imported for the done tile');
  });

  await h.test('DoneStep: both CTAs stand at one height, the design’s 52', async () => {
    const src = read('DoneStep.tsx');
    const height = (name: string): string => /height: ([\d.]+),/.exec(styleBlock(src, name))?.[1] ?? '';
    const primary = height('primary');
    const secondary = height('secondary');
    h.eq(primary, secondary, 'the two stacked actions are never a mismatched pair');
    h.eq(primary, '52', 'and both stand at the design’s 52 (html:527-528)');
  });

  // A prior version of this suite had a test named "AppTile: exports its size constants and no
  // other module restates them" that only asserted `monogram('Pour Timer') === 'PT'` — tautological
  // against its own name. `flow-skeletons.tsx` importing `APP_TILE_SIZE`/`APP_TILE_RADIUS` and
  // using them directly (never restating a literal) is already covered by
  // `prompt-flow-screens.suite.ts` ("skeletons: geometry is imported..."), so it is deleted here
  // rather than fixed in place.
}
