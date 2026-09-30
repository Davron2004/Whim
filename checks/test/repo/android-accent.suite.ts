/**
 * The controls Android draws itself (the text cursor, selection handles, switches) take Whim's
 * accent, not AppCompat's teal default, and text selected under the theme gets the same highlight a
 * launcher field paints. The Android theme can't import the design tokens, so
 * `res/values/styles.xml` points `AppTheme` at colour resources holding the colours' own hex, and
 * nothing but this suite holds those resources to `SHELL_COLORS.accent` and `SELECTION_HIGHLIGHT`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, assert } from '../harness';
import { SHELL_COLORS } from '../../../src/sdk/design-tokens';
import { SELECTION_HIGHLIGHT } from '../../../src/host/launcher/theme';

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

/** An Android `#aarrggbb` resource colour, or an `rgba(r,g,b,a)` string, as channels 0–255. */
function channels(color: string): [number, number, number, number] | undefined {
  const argb = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (argb) return [parseInt(argb[2], 16), parseInt(argb[3], 16), parseInt(argb[4], 16), parseInt(argb[1], 16)];
  const rgba = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(color);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4]) * 255];
  return undefined;
}

/** Whether two colours are the same to within the 8-bit rounding of an Android resource. */
function sameColor(a: string, b: string): boolean {
  const x = channels(a);
  const y = channels(b);
  return x !== undefined && y !== undefined && x.every((c, i) => Math.abs(c - y[i]) <= 0.5);
}

/** One finding per theme colour that isn't the one it must match: the controls' accent, and the
 *  highlight a launcher field paints its selected text with. */
export function androidAccentFindings(styles: string, values: readonly string[], accent: string, highlight: string): string[] {
  const colors = colorResources(values);
  const findings: string[] = [];
  const control = appThemeColor(styles, colors, 'colorAccent');
  if (control?.toLowerCase() !== accent.toLowerCase()) findings.push(`colorAccent resolves to ${String(control)}, not the accent ${accent}`);
  const themed = appThemeColor(styles, colors, 'android:textColorHighlight');
  if (themed === undefined || !sameColor(themed, highlight)) {
    findings.push(`android:textColorHighlight resolves to ${String(themed)}, not a field's highlight ${highlight}`);
  }
  return findings;
}

function valueFiles(): string[] {
  return fs.readdirSync(VALUES_DIR).filter((f) => f.endsWith('.xml')).map((f) => fs.readFileSync(path.join(VALUES_DIR, f), 'utf8'));
}

export async function run(): Promise<void> {
  const styles = fs.readFileSync(path.join(VALUES_DIR, 'styles.xml'), 'utf8');

  await test('android accent: AppTheme’s control colour is the design token’s accent, and its highlight a launcher field’s', () => {
    const findings = androidAccentFindings(styles, valueFiles(), SHELL_COLORS.accent, SELECTION_HIGHLIGHT);
    assert(findings.length === 0, findings.join('; '));
  });

  await test('androidAccentFindings: a theme left on another colour, on another highlight, or on no colour at all, fails', () => {
    const drifted = valueFiles().map((xml) => xml.replace(/(<color name="whim_accent">)#[0-9a-fA-F]+/, '$1#008577'));
    assert(androidAccentFindings(styles, drifted, SHELL_COLORS.accent, SELECTION_HIGHLIGHT).some((f) => f.startsWith('colorAccent')), 'a drifted accent resource is caught');
    const materialAlpha = valueFiles().map((xml) => xml.replace(/(<color name="whim_accent_highlight">)#[0-9a-fA-F]+/, '$1#663f3d8f'));
    assert(
      androidAccentFindings(styles, materialAlpha, SHELL_COLORS.accent, SELECTION_HIGHLIGHT).some((f) => f.startsWith('android:textColorHighlight')),
      'the accent at another alpha than a field’s highlight is caught',
    );
    const unthemed = styles
      .split('\n')
      .filter((line) => !line.includes('<item name="colorAccent">') && !line.includes('<item name="android:textColorHighlight">'))
      .join('\n');
    assert(androidAccentFindings(unthemed, valueFiles(), SHELL_COLORS.accent, SELECTION_HIGHLIGHT).length === 2, 'a theme that sets neither colour is caught twice');
  });
}
