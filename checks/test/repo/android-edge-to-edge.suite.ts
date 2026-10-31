/**
 * Whim draws edge to edge on every Android version (`edgeToEdgeEnabled` in
 * `android/gradle.properties`), and the launcher's keyboard model depends on it: no window resizes
 * for the keyboard, so every frame pads itself by the keyboard's overlap (`keyboard-shell.ts`), the
 * safe-area insets keep content clear of the transparent system bars, and every Modal reaches
 * under both. With the flag off, Android 14 and older would draw inside opaque bars that don't
 * match the app again, and Android 15+ would still force edge to edge: two layouts to keep right
 * instead of one. Nothing but this suite holds the flag on.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, assert } from '../harness';

const GRADLE_PROPERTIES = path.join(process.cwd(), 'android/gradle.properties');

/** The value a Java properties file gives `key`: the last assignment wins, and comment lines
 *  (`#`, `!`) assign nothing; a key ends at its `=` or `:`. `undefined` when no line assigns it. */
export function gradleProperty(text: string, key: string): string | undefined {
  let value: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue;
    const at = line.search(/[=:]/);
    if (at > 0 && line.slice(0, at).trim() === key) value = line.slice(at + 1).trim();
  }
  return value;
}

/** Whether a gradle.properties text turns edge to edge on. */
export function drawsEdgeToEdge(text: string): boolean {
  return gradleProperty(text, 'edgeToEdgeEnabled') === 'true';
}

export async function run(): Promise<void> {
  const properties = fs.readFileSync(GRADLE_PROPERTIES, 'utf8');

  await test('android edge to edge: gradle.properties turns edgeToEdgeEnabled on, which the keyboard model assumes', () => {
    assert(drawsEdgeToEdge(properties), `android/gradle.properties sets edgeToEdgeEnabled to ${String(gradleProperty(properties, 'edgeToEdgeEnabled'))}, not true`);
  });

  await test('drawsEdgeToEdge: a flag turned off, left only in a comment, missing, or turned off by a later line, fails', () => {
    const lines = properties.split('\n');
    const without = lines.filter((line) => !/^\s*edgeToEdgeEnabled\b/.test(line));
    assert(!drawsEdgeToEdge(lines.map((line) => line.replace(/^(\s*edgeToEdgeEnabled\s*=\s*)true/, '$1false')).join('\n')), 'a flag set to false is caught');
    assert(!drawsEdgeToEdge([...without, '# edgeToEdgeEnabled=true'].join('\n')), 'a flag left only in a comment is caught');
    assert(!drawsEdgeToEdge(without.join('\n')), 'a missing flag is caught');
    assert(!drawsEdgeToEdge([...lines, 'edgeToEdgeEnabled=false'].join('\n')), 'a later line turning it off is caught');
    assert(drawsEdgeToEdge([...without, 'edgeToEdgeEnabled = true'].join('\n')), 'spaces around = still turn it on');
  });
}
