// Node acceptance suite for the app tints (`src/design/tints.ts`, docs/design/system.md §2.4):
// the colour maths against published reference values, name resolution against the alias list in
// system.md, the id-hash fallback against `appColor`'s hash, and the host's assignment rules.
// Auto-discovered by `src/sdk/test/run.mjs` (every `*.acceptance.ts(x)` under this directory).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  assignTint,
  ciede2000,
  contrastRatio,
  deltaE,
  fallbackTint,
  farthestTint,
  isTintName,
  mixHex,
  nearestTint,
  resolveTint,
  TINT_ALIASES,
  type Lab,
} from '../../design/tints';
import { TINT_NAMES, TINTS, type TintName } from '../../design/tokens';
import { appColor } from '../design-tokens';

// ── CIEDE2000 ────────────────────────────────────────────────────────────────

// Sharma, Wu & Dalal (2005), "The CIEDE2000 color-difference formula: implementation notes,
// supplementary test data, and mathematical observations", Table 1 (pairs 1–4, 7, 8, 17–21, 25,
// 26, 34): the published reference implementation's inputs and outputs.
const SHARMA: readonly [Lab, Lab, number][] = [
  [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
  [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
  [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
  [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
  [[50, 0, 0], [50, -1, 2], 2.3669],
  [[50, -1, 2], [50, 0, 0], 2.3669],
  [[50, 2.5, 0], [73, 25, -18], 27.1492],
  [[50, 2.5, 0], [61, -5, 29], 22.8977],
  [[50, 2.5, 0], [56, -27, -3], 31.903],
  [[50, 2.5, 0], [58, 24, 15], 19.4535],
  [[50, 2.5, 0], [50, 3.1736, 0.5854], 1.0],
  [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.263],
  [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
];
for (const [a, b, want] of SHARMA) {
  const got = ciede2000(a, b);
  assert.ok(Math.abs(got - want) < 1e-4, `CIEDE2000 ${JSON.stringify(a)} vs ${JSON.stringify(b)}: got ${got.toFixed(4)}, Sharma et al. give ${want}`);
}
assert.deepStrictEqual(deltaE('#535E6F', '#535E6F'), 0, 'a colour is no distance from itself');

// ── WCAG contrast and mixing ─────────────────────────────────────────────────

assert.deepStrictEqual(contrastRatio('#000000', '#FFFFFF'), 21, 'black on white is 21:1');
assert.deepStrictEqual(contrastRatio('#FFFFFF', '#000000'), 21, 'contrast is symmetric');
assert.deepStrictEqual(contrastRatio('#6D6660', '#6D6660'), 1, 'a colour on itself is 1:1');
// #767676 is the darkest grey widely cited as passing 4.5:1 on white; #777777 fails at 4.48.
assert.ok(contrastRatio('#767676', '#FFFFFF') >= 4.5, '#767676 on white passes 4.5:1');
assert.deepStrictEqual(contrastRatio('#777777', '#FFFFFF').toFixed(2), '4.48', '#777777 on white is 4.48:1');
let refused = '';
try {
  contrastRatio('red', '#FFFFFF');
} catch (err) {
  refused = String(err);
}
assert.ok(/not a hex colour/.test(refused), `a name is not a colour the maths accepts (threw ${JSON.stringify(refused)})`);

assert.deepStrictEqual(mixHex('#000000', '#FFFFFF', 0.5), '#808080', 'an even mix of black and white rounds its tie up');
assert.deepStrictEqual(mixHex('#0852CB', '#FFFFFF', 1), '#0852CB', 'all of one colour is that colour');
assert.deepStrictEqual(mixHex('#0852CB', '#FFFFFF', 0), '#FFFFFF', 'none of one colour is the other');

// ── Resolving a declared name ────────────────────────────────────────────────

for (const name of TINT_NAMES) {
  assert.deepStrictEqual(resolveTint(name, 'app-1'), { tint: name }, `"${name}" resolves to itself, with no diagnostic`);
  assert.deepStrictEqual(resolveTint(` ${name.toUpperCase()} `, 'app-1'), { tint: name }, `case and spaces around "${name}" are ignored`);
}

// The alias list is written once in system.md §2.4 for people; the module must say the same.
const systemMd = fs.readFileSync(path.join(process.cwd(), 'docs/design/system.md'), 'utf8');
const aliasProse = /\*\*Aliases\*\*[^:]*:([\s\S]*?)\n- \*\*/.exec(systemMd)?.[1] ?? '';
const documented: Record<string, string> = {};
for (const clause of aliasProse.replace(/\s+/g, ' ').replace(/\.\s*$/, '').split(';')) {
  const [names, tint] = clause.split('→');
  for (const alias of names.split(',')) documented[alias.trim()] = tint.replace(/`/g, '').trim();
}
assert.ok(Object.keys(documented).length >= 10, `system.md's alias list parsed (${Object.keys(documented).length} aliases)`);
assert.deepStrictEqual({ ...TINT_ALIASES }, documented, 'TINT_ALIASES is exactly the alias list of system.md §2.4');

for (const [alias, tint] of Object.entries(TINT_ALIASES)) {
  const r = resolveTint(alias, 'app-1');
  assert.deepStrictEqual(r.tint, tint, `alias "${alias}" resolves to "${tint}"`);
  assert.ok(new RegExp(`"${alias}".*"${tint}"`).test(r.diagnostic ?? ''), `alias "${alias}" resolves with a diagnostic naming both`);
}

for (const unknown of ['chartreuse', '', 42, null, undefined, '#0852CB', 'constructor', '__proto__']) {
  const r = resolveTint(unknown, 'water-counter');
  assert.deepStrictEqual(r.tint, fallbackTint('water-counter'), `unknown tint ${JSON.stringify(unknown)} falls back to the app id's tint`);
  assert.ok((r.diagnostic ?? '').length > 0, `unknown tint ${JSON.stringify(unknown)} carries a diagnostic`);
}

// ── The id-hash fallback ─────────────────────────────────────────────────────

const ids = Array.from({ length: 400 }, (_, i) => `app-${i}-${(i * 7919).toString(36)}`);
assert.deepStrictEqual(new Set(ids.map(fallbackTint)).size, 10, 'the fallback reaches every one of the ten tints');
assert.deepStrictEqual(ids.map((id) => fallbackTint(id)), ids.map(fallbackTint), 'the fallback is deterministic');
// The fallback is "the hash appColor uses today" mod 10: over many ids the tint an id gets and the
// colour appColor gives it must determine each other one to one.
const colourToTint = new Map<string, TintName>();
const tintToColour = new Map<TintName, string>();
for (const id of [...ids, '', 'Water Counter', 'Tip Splitter', 'é☃𝄞']) {
  const colour = appColor(id);
  const tint = fallbackTint(id);
  assert.deepStrictEqual(colourToTint.get(colour) ?? tint, tint, `ids sharing appColor ${colour} share one fallback tint`);
  assert.deepStrictEqual(tintToColour.get(tint) ?? colour, colour, `ids sharing fallback tint ${tint} share one appColor`);
  colourToTint.set(colour, tint);
  tintToColour.set(tint, colour);
}

// ── Nearest tint for an installed hex tileColor ──────────────────────────────

for (const name of TINT_NAMES) {
  assert.deepStrictEqual(nearestTint(TINTS[name].light), name, `a tint's own light value is nearest to it (${name})`);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(TINTS[name].light.slice(i, i + 2), 16));
  const nudged = '#' + [r + 2, g - 2, b + 1].map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('');
  assert.deepStrictEqual(nearestTint(nudged), name, `a colour a step off ${name}'s light value (${nudged}) is still nearest to it`);
}
assert.deepStrictEqual(nearestTint('#fff'), nearestTint('#FFFFFF'), 'short and long hex forms are the same colour');
for (const bad of ['', 'blue', '#12345', '#GGGGGG', 'rgb(0,0,0)']) assert.deepStrictEqual(nearestTint(bad), undefined, `${JSON.stringify(bad)} is not a hex colour`);

// ── Assignment ───────────────────────────────────────────────────────────────

assert.deepStrictEqual(assignTint(['blue', 'ocean'], []), 'blue', 'the model’s first choice, when nobody uses it');
assert.deepStrictEqual(assignTint(['blue', 'ocean'], ['blue']), 'ocean', 'the first ranked tint no installed app uses');
assert.deepStrictEqual(assignTint(['blue'], ['blue', 'slate']), 'stone', 'every ranked tint taken: the least used tint, table order');
assert.deepStrictEqual(assignTint([], []), 'slate', 'no ranked tint and no app: the first tint of the table');
// All ten used once and blue twice: everything but blue is least used, and among those the model's
// order (ocean) beats table order (slate).
assert.deepStrictEqual(assignTint(['blue', 'ocean'], [...TINT_NAMES, 'blue']), 'ocean', 'ties go to the model’s order before table order');
assert.deepStrictEqual(assignTint(['rose', 'blue'], [...TINT_NAMES]), 'rose', 'all equally used: the model’s first choice');

for (const original of TINT_NAMES) {
  const used: TintName[] = [original];
  const copy = farthestTint(original, used);
  assert.ok(copy !== original, `a copy of a ${original} app never takes ${original} while another tint is free`);
  for (const other of TINT_NAMES.filter((t) => t !== original)) {
    assert.ok(
      deltaE(TINTS[original].light, TINTS[copy].light) >= deltaE(TINTS[original].light, TINTS[other].light),
      `a copy of a ${original} app takes the farthest free tint: ${copy} is nearer than ${other}`,
    );
  }
}
// Only one tint is least used: the copy takes it however near it is.
const allButViolet = TINT_NAMES.flatMap((t) => (t === 'violet' ? [] : [t, t]));
assert.deepStrictEqual(farthestTint('indigo', [...allButViolet, 'violet']), 'violet', 'a copy takes the one least used tint');

assert.ok(TINT_NAMES.every(isTintName) && !isTintName('red') && !isTintName(undefined), 'isTintName accepts the ten and nothing else');

console.log('App tints acceptance: PASS');
