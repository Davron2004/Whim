/**
 * Repo-wide source scans for two standing rules that no type or lint rule expresses. They moved
 * here from the launcher suite (test audit 2026-09-21), which is for launcher behaviour.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, assert } from '../harness';
import { WHIM_DOMAIN } from '../../../src/host/launcher/release-config';

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

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// iOS draws any Extended_Pictographic code point from Apple Color Emoji unless U+FE0E (text
// presentation) follows it. Comments are stripped first: a glyph named in prose is not rendered.
function emojiWithoutSelector(text: string): boolean {
  return /\p{Extended_Pictographic}(?!︎)/u.test(text);
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

  await test('source scan: no host source renders an emoji-capable glyph without U+FE0E', () => {
    const hits: string[] = [];
    for (const file of sourceFiles(path.join(ROOT, 'src/host'))) {
      if (file.includes(`${path.sep}test${path.sep}`)) continue;
      withoutComments(fs.readFileSync(file, 'utf8'))
        .split('\n')
        .forEach((line, i) => {
          if (emojiWithoutSelector(line)) hits.push(`${path.relative(ROOT, file)}:${i + 1}`);
        });
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
