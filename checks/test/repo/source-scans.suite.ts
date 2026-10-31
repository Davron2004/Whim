/**
 * Repo-wide source scans for two standing rules that no type or lint rule expresses. They moved
 * here from the launcher suite (test audit 2026-09-21), which is for launcher behaviour.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, assert } from '../harness';
import { WHIM_DOMAIN } from '../../../src/host/launcher/release-config';
import { EXTENDED_PICTOGRAPHIC_RANGES, isExtendedPictographic } from './extended-pictographic';

const ROOT = process.cwd();

/** Every `.ts`/`.tsx` file under `dir`, recursively. */
function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) files.push(full);
  }
  return files;
}

/** `text` with its comments blanked. A block comment keeps its newlines, so every line of the
 *  result is the same line of the file and a hit reports the line it is on (#87). */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, '')).replace(/\/\/[^\n]*/g, '');
}

const TEXT_PRESENTATION = 0xfe0e;

// iOS draws any Extended_Pictographic code point from Apple Color Emoji unless U+FE0E (text
// presentation) follows it. Comments are stripped first: a glyph named in prose is not rendered.
// The code points come from a pinned Unicode table, not `\p{Extended_Pictographic}`, whose answer
// depends on the Node version's ICU data.
function emojiWithoutSelector(text: string): boolean {
  const codePoints = Array.from(text, (char) => char.codePointAt(0) ?? 0);
  return codePoints.some((codePoint, i) => isExtendedPictographic(codePoint) && codePoints[i + 1] !== TEXT_PRESENTATION);
}

/** The 1-based lines of `source` that render an emoji-capable glyph without U+FE0E. */
function emojiHitLines(source: string): number[] {
  const lines: number[] = [];
  withoutComments(source)
    .split('\n')
    .forEach((line, i) => {
      if (emojiWithoutSelector(line)) lines.push(i + 1);
    });
  return lines;
}

// Every URL release-config derives contains WHIM_DOMAIN, so one case-insensitive search catches the
// domain and any hardcoded derived URL. It does not match the `whim.<name>:v1` KV-key convention.
const DOMAIN_LITERAL = new RegExp(WHIM_DOMAIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
const RELEASE_CONFIG_TS = path.join(ROOT, 'src/host/launcher/release-config.ts');

export async function run(): Promise<void> {
  await test('source scan: the emoji scan tells a comment from a live literal', () => {
    assert(!emojiWithoutSelector(withoutComments('// a bare gear ⚙ in prose')), 'a glyph inside a comment must not fire the scan');
    assert(emojiWithoutSelector(withoutComments("const glyph = '⚙';")), 'the same glyph in a string literal, with no selector, must fire');
    assert(!emojiWithoutSelector(withoutComments("const glyph = '⚙︎';")), 'adding the selector clears it');
  });

  await test('source scan: the emoji table is Unicode 17.0 Extended_Pictographic, whatever the Node ICU', () => {
    const size = EXTENDED_PICTOGRAPHIC_RANGES.reduce((total, [first, last]) => total + last - first + 1, 0);
    assert(size === 2848, `Unicode 17.0 emoji-data.txt lists 2848 Extended_Pictographic code points, the table holds ${size}`);
    const sorted = EXTENDED_PICTOGRAPHIC_RANGES.every(([first, last], i) => first <= last && (i === 0 || first > EXTENDED_PICTOGRAPHIC_RANGES[i - 1][1] + 1));
    assert(sorted, 'the ranges are sorted, disjoint and merged, which the binary search relies on');
    // Unicode 16 counted these two pictographic; Unicode 17 does not (#87).
    assert(!emojiWithoutSelector("const edit = '\u270E', flag = '\u2691';"), 'U+270E and U+2691 are not Extended_Pictographic in 17.0');
    assert(emojiWithoutSelector("const party = '\u{1F389}';"), 'a supplementary-plane emoji (U+1F389) fires the scan');
    assert(emojiWithoutSelector("const copy = '\u00A9';"), 'the first range (U+00A9) is reached');
    assert(emojiWithoutSelector("const last = '\u{1FFFD}';"), 'the last range (U+1FFFD) is reached');
  });

  await test('source scan: a hit reports its line in the file, after a multi-line block comment too', () => {
    const source = ['/*', ' * two lines of prose', ' */', "const a = 'plain';", "const b = '\u2699';"].join('\n');
    assert(emojiHitLines(source).join(',') === '5', `got lines ${emojiHitLines(source).join(',')}, expected 5`);
  });

  await test('source scan: no host source renders an emoji-capable glyph without U+FE0E', () => {
    const hits: string[] = [];
    for (const file of sourceFiles(path.join(ROOT, 'src/host'))) {
      if (file.includes(`${path.sep}test${path.sep}`)) continue;
      for (const line of emojiHitLines(fs.readFileSync(file, 'utf8'))) hits.push(`${path.relative(ROOT, file)}:${line}`);
    }
    assert(hits.length === 0, `every emoji-capable glyph the shell renders must be followed by U+FE0E, or iOS draws it in colour: ${hits.join(', ')}`);
  });

  await test('source scan: the domain pattern catches the domain and derived URLs, not the KV-key convention', () => {
    assert(DOMAIN_LITERAL.test(`const x = "${WHIM_DOMAIN}";`), 'matches the domain');
    assert(DOMAIN_LITERAL.test(`https://WHIM.${WHIM_DOMAIN.toUpperCase()}/support`), 'matches a derived URL in any case');
    assert(!DOMAIN_LITERAL.test("const CONSENT_KEY = 'whim.ai-consent:v1';"), 'does not match the whim.<name>:v1 KV keys');
  });

  await test('source scan: only release-config.ts names the release domain in launcher source', () => {
    const scanned = sourceFiles(path.join(ROOT, 'src/host/launcher'));
    assert(scanned.includes(RELEASE_CONFIG_TS), 'the walk reaches release-config.ts, so it is skipped by path rather than missed');
    const hits = scanned.filter((file) => file !== RELEASE_CONFIG_TS && DOMAIN_LITERAL.test(fs.readFileSync(file, 'utf8')));
    assert(hits.length === 0, `derive the domain from release-config.ts's RELEASE instead: ${hits.map((f) => path.relative(ROOT, f)).join(', ')}`);
  });
}
