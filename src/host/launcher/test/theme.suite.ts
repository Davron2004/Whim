/** The one standing theme rule the launcher suite still checks: an emoji-capable glyph in host
 * source always asks for text presentation. */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from './harness';

/** Every file under `src/`, recursively — no exclusions: `invariants/` (the owner-authored
 *  negative-control fixtures) lives OUTSIDE `src/`, so there is nothing to carve out here. */
function everySourceFile(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...everySourceFile(full));
    else files.push(full);
  }
  return files;
}

export async function runThemeTests(h: Harness): Promise<void> {
  // ── review fix F1: an emoji-capable glyph in source always asks for text presentation ───────
  // iOS draws any `Emoji=Yes`/`Extended_Pictographic=Yes` code point from Apple Color Emoji unless
  // it is immediately followed by the U+FE0E text-presentation selector — no typecheck or lint
  // catches the omission. Comments are stripped first, since a glyph mentioned in prose (this
  // very finding, for instance) is not something the app renders.
  function withoutComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  }

  function emojiWithoutSelector(text: string): boolean {
    return /\p{Extended_Pictographic}(?!︎)/u.test(text);
  }

  await h.test('theme (non-vacuity): the emoji-without-selector scan tells a comment from a live literal', async () => {
    h.ok(!emojiWithoutSelector(withoutComments('// a bare gear ⚙ in prose')), 'a glyph inside a comment must not fire the scan');
    h.ok(emojiWithoutSelector(withoutComments("const glyph = '⚙';")), 'the same glyph in a string literal, with no selector, must fire the scan');
    h.ok(!emojiWithoutSelector(withoutComments("const glyph = '⚙︎';")), 'and adding the selector clears it');
  });

  await h.test('theme: no non-test src/host source renders an emoji-capable glyph without U+FE0E', async () => {
    const hits: string[] = [];
    for (const file of everySourceFile(path.join(process.cwd(), 'src/host'))) {
      if (!/\.tsx?$/.test(file)) continue;
      if (file.includes(`${path.sep}test${path.sep}`)) continue;
      const lines = withoutComments(fs.readFileSync(file, 'utf8')).split('\n');
      lines.forEach((line, i) => {
        if (emojiWithoutSelector(line)) hits.push(`${path.relative(process.cwd(), file)}:${i + 1}`);
      });
    }
    h.eq(hits, [], 'every emoji-capable glyph rendered by the shell must be followed by U+FE0E, or iOS draws it in colour');
  });
}
