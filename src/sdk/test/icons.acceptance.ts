// Node acceptance suite for the vendored icon set and its resolvers (`docs/design/system.md` §3.1, §3.3;
// sdk-design-system "An app names its tint and glyph, and every name resolves", "One vendored icon set
// draws every icon"). Auto-discovered by `src/sdk/test/run.mjs`. The name lists, keyword table and alias
// examples are checked against `system.md` itself, and the path data against the mockup it was vendored from.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  CHROME_NAMES,
  FALLBACK_ICON,
  GLYPH_GROUPS,
  GLYPH_NAMES,
  ICON_ALIASES,
  ICON_KEYWORDS,
  ICON_NAMES,
  resolveGlyph,
  resolveIcon,
} from '../../design/icons/names';
import { ICON_PATHS, ICON_VIEWBOX } from '../../design/icons/paths';
import { EMBER_PATH, EMBER_VIEWBOX } from '../../design/icons/ember';
import { SQUIRCLE_CORNER, squirclePath } from '../../design/icons/squircle';

const root = process.cwd();
const read = (relative: string): string => {
  const file = path.join(root, relative);
  assert.ok(fs.existsSync(file), `${relative} exists (run from the repo root)`);
  return fs.readFileSync(file, 'utf8');
};
const systemMd = read('docs/design/system.md');
const mockup = read('docs/design/mockups/index.html');
const ticked = (text: string): string[] => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

// ── The lists match system.md §3.1 ────────────────────────────────────────────

{
  const table = systemMd.slice(systemMd.indexOf('| Group | Glyphs |'));
  const rows = table.slice(0, table.indexOf('\n\n')).split('\n').slice(2);
  const groups = Object.fromEntries(rows.map((row) => {
    const [, group, glyphs] = row.split('|').map((cell) => cell.trim());
    return [group, ticked(glyphs)];
  }));
  assert.deepStrictEqual(GLYPH_GROUPS, groups, 'GLYPH_GROUPS is the glyph table of system.md §3.1, group by group');
  assert.deepStrictEqual(GLYPH_NAMES.length, 147, 'the glyph set has 147 glyphs');
  assert.deepStrictEqual(new Set(GLYPH_NAMES).size, GLYPH_NAMES.length, 'no glyph is listed twice');

  const chromeText = systemMd.slice(systemMd.indexOf('The **chrome set**'), systemMd.indexOf('(fallback only)'));
  const chrome = ticked(chromeText);
  assert.deepStrictEqual(chrome.pop(), FALLBACK_ICON, 'system.md names `circle` as the fallback after the chrome set');
  assert.deepStrictEqual([...CHROME_NAMES], chrome, 'CHROME_NAMES is the chrome set of system.md §3.1');
  assert.ok(CHROME_NAMES.every((name) => !GLYPH_NAMES.includes(name as never)), 'the chrome and glyph sets are disjoint');
  assert.ok(!ICON_NAMES.slice(0, -1).includes(FALLBACK_ICON), '`circle` is in neither offered set');
}

{
  const start = systemMd.indexOf('| Words (whole, lower-cased) |');
  const rows = systemMd.slice(start, systemMd.indexOf('\n\n', start)).split('\n').slice(2);
  const expected = new Map<string, string>();
  for (const row of rows) {
    const cells = row.split('|').map((cell) => cell.trim()).filter((cell) => cell !== '');
    for (let i = 0; i < cells.length; i += 2) {
      for (const word of cells[i].split(',')) expected.set(word.trim(), ticked(cells[i + 1])[0]);
    }
  }
  const actual = new Map<string, string>();
  for (const [glyph, words] of ICON_KEYWORDS) for (const word of words) actual.set(word, glyph);
  assert.deepStrictEqual(actual, expected, 'ICON_KEYWORDS is the keyword table of system.md §3.1');
}

// ── Every name resolves ───────────────────────────────────────────────────────

for (const name of [...GLYPH_NAMES, ...CHROME_NAMES]) {
  assert.deepStrictEqual(resolveIcon(name), { name }, `Icon "${name}" draws itself with no diagnostic`);
}
for (const name of GLYPH_NAMES) {
  assert.deepStrictEqual(resolveGlyph(name), { name }, `tile glyph "${name}" draws itself with no diagnostic`);
}
for (const name of CHROME_NAMES) {
  assert.deepStrictEqual(resolveGlyph(name).name, FALLBACK_ICON, `chrome "${name}" never draws a tile`);
  assert.deepStrictEqual(resolveGlyph(name).diagnostic?.kind, 'icon_fallback', `chrome "${name}" as a tile is reported`);
}

// ── Aliases ───────────────────────────────────────────────────────────────────

{
  const forgiving = systemMd.slice(systemMd.indexOf('**Forgiving names.**'), systemMd.indexOf('the full map ships'));
  const pairs = [...forgiving.matchAll(/`([^`]+)`→\s*`([^`]+)`/g)].map((m) => [m[1], m[2]] as const);
  assert.ok(pairs.length >= 8, 'system.md lists its alias examples');
  for (const [legacy, current] of pairs) {
    const resolved = resolveIcon(legacy);
    assert.deepStrictEqual(resolved.name, current, `system.md alias ${legacy} → ${current}`);
    assert.deepStrictEqual(resolved.diagnostic?.kind, 'icon_alias', `${legacy} records an alias diagnostic, not an error`);
    assert.deepStrictEqual(resolved.diagnostic?.requested, legacy, `${legacy}'s diagnostic names what was asked for`);
  }
  assert.deepStrictEqual(resolveGlyph('home').name, 'house', 'a tile declaring `home` shows `house`');
}

for (const [alias, target] of Object.entries(ICON_ALIASES)) {
  assert.ok(!ICON_NAMES.includes(alias as never), `alias "${alias}" does not shadow a real name`);
  assert.ok(ICON_NAMES.includes(target), `alias "${alias}" points into the set ("${target}")`);
}
assert.deepStrictEqual(resolveIcon('more-horizontal').name, 'ellipsis', 'a chrome alias resolves for Icon');
assert.deepStrictEqual(resolveGlyph('more-horizontal').name, FALLBACK_ICON, 'an alias into the chrome set never draws a tile');
assert.deepStrictEqual(
  resolveIcon('  Timer '),
  { name: 'timer', diagnostic: { kind: 'icon_alias', requested: '  Timer ', resolved: 'timer', message: 'Icon "  Timer " is drawn as "timer".' } },
  'case and surrounding space are forgiven, with a diagnostic',
);

// ── Keywords: the name's words, then the app's name ───────────────────────────

const keywordCases: Array<[string, string | undefined, string]> = [
  ['pomodoro', undefined, 'timer'],
  ['water-tracker', undefined, 'glass-water'],
  ['hydration', undefined, 'glass-water'],
  ['spending-log', undefined, 'wallet'],
  ['pour-over', undefined, 'coffee'],
  ['coffee-timer', undefined, 'coffee'],
  ['timer-coffee', undefined, 'timer'],
  ['habits', undefined, 'calendar-check'],
  ['coinFlip', undefined, 'coins'],
  ['sparkles', 'Daily habits', 'calendar-check'],
  ['sparkles', 'Pour-over Brewer', 'coffee'],
  ['pomodoro', 'Daily habits', 'timer'],
];
for (const [name, appName, glyph] of keywordCases) {
  for (const resolve of [resolveIcon, resolveGlyph]) {
    const first = resolve(name, appName);
    assert.deepStrictEqual(first.name, glyph, `"${name}" in app "${appName ?? '-'}" → ${glyph}`);
    assert.deepStrictEqual(first.diagnostic?.kind, 'icon_keyword', `"${name}" records a keyword diagnostic`);
    assert.deepStrictEqual(resolve(name, appName), first, `"${name}" resolves the same way every time`);
  }
}
assert.deepStrictEqual(resolveIcon('pour').name, FALLBACK_ICON, 'half of a two-word keyword does not match');
assert.deepStrictEqual(resolveIcon('timers-x').name, 'timer', 'a plain keyword takes its plural');
assert.deepStrictEqual(resolveIcon('stopwatch').name, FALLBACK_ICON, 'keywords match whole words, never substrings');

// ── Unknown names fall back to `circle` ───────────────────────────────────────

for (const name of ['chartreuse-thing', '', '   ', '__proto__', 'constructor', 'toString', 'sparkles', '🔥']) {
  for (const resolve of [resolveIcon, resolveGlyph]) {
    const resolved = resolve(name, 'Untitled');
    assert.deepStrictEqual(resolved.name, FALLBACK_ICON, `unknown "${name}" falls back to circle`);
    assert.deepStrictEqual(resolved.diagnostic?.kind, 'icon_fallback', `unknown "${name}" records a fallback diagnostic`);
    assert.deepStrictEqual(resolved.diagnostic?.resolved, FALLBACK_ICON, `"${name}"'s diagnostic names the drawn icon`);
    assert.ok((resolved.diagnostic?.message ?? '').includes(name), `"${name}"'s diagnostic message quotes the request`);
  }
}

// ── Paths: every name has one, matching the vendored source ───────────────────

assert.deepStrictEqual(ICON_VIEWBOX, 24, 'icons are on the 24 grid');
assert.deepStrictEqual(Object.keys(ICON_PATHS).sort((a, b) => a.localeCompare(b)), [...ICON_NAMES].sort((a, b) => a.localeCompare(b)), 'exactly the glyph, chrome and fallback icons are vendored');
for (const name of ICON_NAMES) {
  const d = ICON_PATHS[name];
  assert.ok(/^M[\d\s.,MLHVCSQTAZmlhvcsqtaz-]+$/.test(d), `"${name}" has well-formed path data`);
}
{
  // Icons drawn only with <path> in Lucide must be those paths joined, each starting with an absolute moveto.
  let compared = 0;
  for (const [, name, markup] of mockup.matchAll(/^ {2}'([a-z0-9-]+)': '([^']*)',$/gm)) {
    if (!ICON_NAMES.includes(name as never) || !/^(<path d="M[^"]*"\/>)+$/.test(markup)) continue;
    const joined = [...markup.matchAll(/d="([^"]*)"/g)].map((m) => m[1]).join('');
    assert.deepStrictEqual(ICON_PATHS[name as keyof typeof ICON_PATHS], joined, `"${name}" matches the vendored Lucide paths`);
    compared += 1;
  }
  assert.ok(compared >= 40, `the source comparison covers many icons (${compared})`);
}
{
  const license = read('src/design/icons/LICENSE');
  assert.ok(license.startsWith('ISC License'), 'the ISC notice ships with the icons');
  assert.ok(license.includes('Lucide Contributors'), 'the notice credits Lucide');
}

// ── The ember ─────────────────────────────────────────────────────────────────

{
  const source = /const EMBER_PATH = '([^']+)';/.exec(mockup);
  assert.ok(source, 'the mockup defines EMBER_PATH');
  assert.deepStrictEqual(EMBER_PATH, source[1], 'the ember silhouette is the mockup\'s');
  const coords = (EMBER_PATH.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  assert.ok(coords.every((n) => n >= 0 && n <= EMBER_VIEWBOX), 'the ember stays on its 48 grid');
  assert.ok(EMBER_PATH.endsWith('Z'), 'the ember is one closed silhouette');
}

// ── The squircle ──────────────────────────────────────────────────────────────

function pointsOf(d: string): Array<[number, number]> {
  // Every command here is absolute; an arc carries rx ry rotation large sweep before its endpoint.
  const points: Array<[number, number]> = [];
  for (const [, command, args] of d.matchAll(/([MLCA])([^MLCAZ]*)/g)) {
    const n = args.trim().split(/[\s,]+/).map(Number);
    const xy = command === 'A' ? n.slice(5) : n;
    for (let i = 0; i < xy.length; i += 2) points.push([xy[i], xy[i + 1]]);
  }
  return points;
}

for (const size of [24, 40, 64, 96]) {
  const d = squirclePath(size);
  assert.ok(/^M[^Z]*Z$/.test(d), `squircle ${size} is one closed path`);
  const points = pointsOf(d);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  assert.deepStrictEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [0, size, 0, size], `squircle ${size} fills its square edge to edge`);

  // Each corner's middle is a circle of radius 22.5% of the side, tangent to both edges.
  const radius = SQUIRCLE_CORNER * size;
  const arcs = [...d.matchAll(/A([^MLCAZ]*)/g)].map((m) => m[1].trim().split(/[\s,]+/).map(Number));
  assert.deepStrictEqual(arcs.length, 4, `squircle ${size} has four corners`);
  const centres: Array<[number, number]> = [[size - radius, radius], [size - radius, size - radius], [radius, size - radius], [radius, radius]];
  const all = points.map(([x, y]) => `${x},${y}`);
  arcs.forEach((arc, i) => {
    assert.ok(Math.abs(arc[0] - radius) < 0.001 && Math.abs(arc[1] - radius) < 0.001, `squircle ${size} corner radius is 22.5%`);
    const end = [arc[5], arc[6]];
    const before = all.indexOf(`${end[0]},${end[1]}`) - 1;
    const begin = points[before];
    for (const [x, y] of [begin, end]) {
      const distance = Math.hypot(x - centres[i][0], y - centres[i][1]);
      assert.ok(Math.abs(distance - radius) < 0.01, `squircle ${size} corner ${i} arc lies on its circle (${distance})`);
    }
  });

  // Four-fold symmetry: mirrored across both axes, the outline is the same point set.
  const near = (px: number, py: number): boolean => points.some(([x, y]) => Math.abs(x - px) < 0.01 && Math.abs(y - py) < 0.01);
  for (const [x, y] of points) {
    assert.ok(near(size - x, y), `squircle ${size} is symmetric left to right`);
    assert.ok(near(x, size - y), `squircle ${size} is symmetric top to bottom`);
  }
}
{
  const small = pointsOf(squirclePath(64));
  const large = pointsOf(squirclePath(128));
  assert.ok(small.every(([x, y], i) => Math.abs(large[i][0] - 2 * x) < 0.01 && Math.abs(large[i][1] - 2 * y) < 0.01), 'the squircle scales with its size');
}

console.log(`icons acceptance: ${ICON_NAMES.length} icons, ${Object.keys(ICON_ALIASES).length} aliases, ${keywordCases.length} keyword cases`);
