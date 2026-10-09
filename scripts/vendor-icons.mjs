#!/usr/bin/env node
/**
 * Vendors the Lucide subset of `docs/design/system.md` §3.1 into `src/design/icons/paths.ts` (one SVG
 * path `d` per icon on the 24 grid, drawn stroked: fill none, round caps and joins) and writes the ISC
 * notice to `src/design/icons/LICENSE`.
 *
 * Source: the `ICONS` map of `docs/design/mockups/index.html`, which is lucide-static@0.460.0's inner
 * SVG markup copied verbatim (ISC, credited there). Reading it keeps vendoring offline and adds no
 * dependency. The name list is `ICON_NAMES` from `src/design/icons/names.ts`; a name the mockup lacks
 * fails the run. `<circle>`, `<rect>`, `<line>`, `<polyline>` and `<polygon>` become path commands with
 * the same geometry, so every icon is one `d` string for `react-native-svg` and inline `<svg>` alike.
 *
 *   node scripts/vendor-icons.mjs
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOCKUP = path.join(root, 'docs/design/mockups/index.html');
const NAMES = path.join(root, 'src/design/icons/names.ts');
const OUT_PATHS = path.join(root, 'src/design/icons/paths.ts');
const OUT_LICENSE = path.join(root, 'src/design/icons/LICENSE');
const LUCIDE_VERSION = '0.460.0';

const LICENSE = `ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT).
All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

The path data in paths.ts is taken from lucide-static@${LUCIDE_VERSION} (https://lucide.dev).
`;

async function loadIconNames() {
  const result = await build({
    entryPoints: [NAMES],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    tsconfigRaw: '{}',
    logLevel: 'warning',
  });
  const source = result.outputFiles[0].text;
  const mod = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  return mod.ICON_NAMES;
}

/** The mockup's `ICONS` entries: `'name': '<inner markup>',` lines inside `const ICONS = {` and `Object.assign(ICONS, {`. */
function readMockupIcons() {
  const lines = fs.readFileSync(MOCKUP, 'utf8').split('\n');
  const icons = new Map();
  let inside = false;
  for (const line of lines) {
    if (line === 'const ICONS = {' || line === 'Object.assign(ICONS, {') {
      inside = true;
      continue;
    }
    if (inside && (line === '};' || line === '});')) {
      inside = false;
      continue;
    }
    if (!inside) continue;
    const entry = /^ {2}'([a-z0-9-]+)': '([^']*)',$/.exec(line);
    if (!entry) throw new Error(`vendor-icons: unreadable ICONS line in the mockup: ${line.slice(0, 80)}`);
    if (icons.has(entry[1])) throw new Error(`vendor-icons: icon "${entry[1]}" appears twice in the mockup`);
    icons.set(entry[1], entry[2]);
  }
  return icons;
}

const num = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`vendor-icons: not a number: ${value}`);
  return String(Number(n.toFixed(3)));
};

function attributesOf(text) {
  // `a="1" b="2"` splits on quotes into name/value pairs.
  const parts = text.split('"');
  const attrs = {};
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const key = parts[i].trim();
    attrs[key.endsWith('=') ? key.slice(0, -1) : key] = parts[i + 1];
  }
  return attrs;
}

function pointsPath(points, close) {
  const coords = points.trim().split(/[\s,]+/).map(num);
  if (coords.length < 4 || coords.length % 2 !== 0) throw new Error(`vendor-icons: bad points "${points}"`);
  const pairs = [];
  for (let i = 0; i < coords.length; i += 2) pairs.push(`${coords[i]} ${coords[i + 1]}`);
  return `M${pairs[0]}L${pairs.slice(1).join(' ')}${close ? 'Z' : ''}`;
}

function ellipsePath(cx, cy, rx, ry) {
  const [x, y, a, b] = [cx, cy, rx, ry].map(Number);
  return `M${num(x - a)} ${num(y)}a${num(a)} ${num(b)} 0 1 0 ${num(2 * a)} 0a${num(a)} ${num(b)} 0 1 0 ${num(-2 * a)} 0`;
}

function rectPath(attrs) {
  const x = Number(attrs.x ?? 0);
  const y = Number(attrs.y ?? 0);
  const w = Number(attrs.width);
  const h = Number(attrs.height);
  const rx = Math.min(Number(attrs.rx ?? attrs.ry ?? 0), w / 2);
  const ry = Math.min(Number(attrs.ry ?? attrs.rx ?? 0), h / 2);
  if (rx === 0 || ry === 0) return `M${num(x)} ${num(y)}h${num(w)}v${num(h)}h${num(-w)}Z`;
  const arc = (dx, dy) => `a${num(rx)} ${num(ry)} 0 0 1 ${num(dx)} ${num(dy)}`;
  return (
    `M${num(x + rx)} ${num(y)}h${num(w - 2 * rx)}${arc(rx, ry)}v${num(h - 2 * ry)}${arc(-rx, ry)}` +
    `h${num(-(w - 2 * rx))}${arc(-rx, -ry)}v${num(-(h - 2 * ry))}${arc(rx, -ry)}Z`
  );
}

/**
 * A path's opening `m` is absolute (it is relative to the origin), but once joined after another subpath it
 * would move from that subpath's end. Rewrite it as `M`, keeping any implicit pairs after it as relative `l`.
 */
function absoluteStart(name, d) {
  if (d.startsWith('M')) return d;
  const next = d.slice(1).search(/[a-zA-Z]/);
  const end = next === -1 ? d.length : next + 1;
  const numbers = d.slice(1, end).match(/-?\d*\.?\d+/g) ?? [];
  if (!d.startsWith('m') || numbers.length < 2 || numbers.length % 2 !== 0) {
    throw new Error(`vendor-icons: ${name}: a path must start with a moveto: "${d.slice(0, 40)}"`);
  }
  const lineto = numbers.length > 2 ? `l${numbers.slice(2).join(' ')}` : '';
  return `M${numbers[0]} ${numbers[1]}${lineto}${d.slice(end)}`;
}

/** One `d` string for an icon's inner markup; every subpath starts with an absolute moveto. */
function toPath(name, markup) {
  const parts = [];
  const rest = markup.replace(/<([a-z]+) ([^>]*)\/>/g, (_, tag, body) => {
    const a = attributesOf(body);
    switch (tag) {
      case 'path':
        parts.push(absoluteStart(name, a.d));
        break;
      case 'circle':
        parts.push(ellipsePath(a.cx, a.cy, a.r, a.r));
        break;
      case 'ellipse':
        parts.push(ellipsePath(a.cx, a.cy, a.rx, a.ry));
        break;
      case 'rect':
        parts.push(rectPath(a));
        break;
      case 'line':
        parts.push(`M${num(a.x1)} ${num(a.y1)}L${num(a.x2)} ${num(a.y2)}`);
        break;
      case 'polyline':
        parts.push(pointsPath(a.points, false));
        break;
      case 'polygon':
        parts.push(pointsPath(a.points, true));
        break;
      default:
        throw new Error(`vendor-icons: ${name}: unsupported <${tag}>`);
    }
    return '';
  });
  if (rest.trim() !== '') throw new Error(`vendor-icons: ${name}: unconverted markup "${rest.trim().slice(0, 60)}"`);
  if (parts.length === 0) throw new Error(`vendor-icons: ${name}: no shapes`);
  return parts.join('');
}

const names = await loadIconNames();
const mockup = readMockupIcons();
const missing = names.filter((name) => !mockup.has(name));
if (missing.length > 0) throw new Error(`vendor-icons: the mockup lacks ${missing.join(', ')}`);

const body = names.map((name) => `  '${name}': '${toPath(name, mockup.get(name))}',`).join('\n');
const paths = `// Generated by scripts/vendor-icons.mjs from lucide-static@${LUCIDE_VERSION} (ISC, see ./LICENSE). Do not edit.
// One SVG path \`d\` per icon on a 24 × 24 grid, drawn with fill none, stroke currentColor, round caps and joins.
import type { IconName } from './names';

export const ICON_VIEWBOX = 24;

export const ICON_PATHS: Readonly<Record<IconName, string>> = {
${body}
};
`;

fs.writeFileSync(OUT_PATHS, paths);
fs.writeFileSync(OUT_LICENSE, LICENSE);
console.log(`vendor-icons: ${names.length} icons → ${path.relative(root, OUT_PATHS)}`);
