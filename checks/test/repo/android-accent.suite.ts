/**
 * The controls Android draws itself (the text cursor, selection handles, switches) take Whim's
 * accent, not AppCompat's teal default. The Android theme can't import the design tokens, so
 * `res/values/styles.xml` points `AppTheme` at colour resources holding the accent's own hex, and
 * nothing but this suite holds those resources to `SHELL_COLORS.accent`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, assert } from '../harness';
import { SHELL_COLORS } from '../../../src/sdk/design-tokens';

const VALUES_DIR = path.join(process.cwd(), 'android/app/src/main/res/values');

/** Every `<color name="…">#…</color>` across the values resource files, by name. */
function colorResources(files: readonly string[]): Map<string, string> {
  const colors = new Map<string, string>();
  for (const xml of files) {
    for (const [, name, value] of xml.matchAll(/<color name="([^"]+)">\s*(#[0-9a-fA-F]+)\s*<\/color>/g)) colors.set(name, value);
  }
  return colors;
}

/** The hex `AppTheme`'s `item` resolves to through a `@color/…` reference, or `undefined`. */
function appThemeColor(styles: string, colors: Map<string, string>, item: string): string | undefined {
  const theme = /<style name="AppTheme"[^>]*>([\s\S]*?)<\/style>/.exec(styles)?.[1] ?? '';
  const escaped = item.replace(/[.:]/g, (c) => `\\${c}`);
  const ref = new RegExp(`<item name="${escaped}">@color/([^<\\s]+)</item>`).exec(theme)?.[1];
  return ref === undefined ? undefined : colors.get(ref);
}

/** One finding per accent-derived theme colour that isn't the design token's accent. */
export function androidAccentFindings(styles: string, values: readonly string[], accent: string): string[] {
  const colors = colorResources(values);
  const findings: string[] = [];
  const control = appThemeColor(styles, colors, 'colorAccent');
  if (control?.toLowerCase() !== accent.toLowerCase()) findings.push(`colorAccent resolves to ${String(control)}, not the accent ${accent}`);
  const highlight = appThemeColor(styles, colors, 'android:textColorHighlight');
  if (highlight === undefined || highlight.length !== 9 || highlight.slice(3).toLowerCase() !== accent.slice(1).toLowerCase()) {
    findings.push(`android:textColorHighlight resolves to ${String(highlight)}, not the accent ${accent} at an alpha`);
  }
  return findings;
}

function valueFiles(): string[] {
  return fs.readdirSync(VALUES_DIR).filter((f) => f.endsWith('.xml')).map((f) => fs.readFileSync(path.join(VALUES_DIR, f), 'utf8'));
}

export async function run(): Promise<void> {
  const styles = fs.readFileSync(path.join(VALUES_DIR, 'styles.xml'), 'utf8');

  await test('android accent: AppTheme’s control and highlight colours are the design token’s accent', () => {
    const findings = androidAccentFindings(styles, valueFiles(), SHELL_COLORS.accent);
    assert(findings.length === 0, findings.join('; '));
  });

  await test('androidAccentFindings: a theme left on another colour, or on no colour at all, fails', () => {
    const drifted = valueFiles().map((xml) => xml.replace(/(<color name="whim_accent">)#[0-9a-fA-F]+/, '$1#008577'));
    assert(androidAccentFindings(styles, drifted, SHELL_COLORS.accent).some((f) => f.startsWith('colorAccent')), 'a drifted accent resource is caught');
    const unthemed = styles
      .split('\n')
      .filter((line) => !line.includes('<item name="colorAccent">') && !line.includes('<item name="android:textColorHighlight">'))
      .join('\n');
    assert(androidAccentFindings(unthemed, valueFiles(), SHELL_COLORS.accent).length === 2, 'a theme that sets neither colour is caught twice');
  });
}
