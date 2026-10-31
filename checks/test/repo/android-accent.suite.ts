/**
 * The controls Android draws itself (the text cursor, selection handles, switches) are ink, and
 * text selected under the theme gets an ink highlight that keeps it readable, in both schemes
 * (docs/design/system.md §2.6 "Selection is ink"; design-system-v1 D12). The Android theme can't
 * import the design tokens, so `res/values/styles.xml` points `AppTheme` at colour resources
 * holding the colours' own hex, `values/` for light and `values-night/` for dark, and nothing but
 * this suite holds those resources to the token module.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, assert } from '../harness';
import { COLORS, SCHEMES, type Scheme } from '../../../src/design/tokens';
import { contrastRatio, mixHex } from '../../../src/design/tints';

const RES_DIR = path.join(process.cwd(), 'android/app/src/main/res');
const VALUES_DIR: Readonly<Record<Scheme, string>> = { light: 'values', dark: 'values-night' };

/** Readable over a selection: the WCAG floor for body text. Visible: the highlight stands off the
 *  canvas at least as far as a non-text UI edge must (WCAG 1.4.11 asks 3:1 of controls; a tint
 *  behind text needs only to be seen, so half of that). */
const READABLE = 4.5;
const VISIBLE = 1.5;

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

/** An Android `#rrggbb` or `#aarrggbb` colour as `#RRGGBB` plus its alpha (0–1). */
function parseAndroidColor(color: string): { rgb: string; alpha: number } | undefined {
  const m = /^#([0-9a-f]{2})?([0-9a-f]{6})$/i.exec(color);
  if (!m) return undefined;
  return { rgb: `#${m[2].toUpperCase()}`, alpha: m[1] === undefined ? 1 : parseInt(m[1], 16) / 255 };
}

/**
 * One finding per theme colour in `scheme` that breaks the rule: the caret is `text`, the selection
 * is `text` at an alpha under which `text` stays readable on every canvas a field sits on (`bg`,
 * `surface`, `sheet`) and the highlight still shows against it. `values` are the resource files the
 * scheme resolves (light: `values/`; dark: `values/` overridden by `values-night/`).
 */
export function androidAccentFindings(scheme: Scheme, styles: string, values: readonly string[]): string[] {
  const colors = colorResources(values);
  const ink = COLORS[scheme].text;
  const findings: string[] = [];
  const caret = appThemeColor(styles, colors, 'colorAccent');
  if (caret?.toUpperCase() !== ink.toUpperCase()) findings.push(`${scheme}: colorAccent resolves to ${String(caret)}, not text ${ink}`);

  const raw = appThemeColor(styles, colors, 'android:textColorHighlight');
  const selection = raw === undefined ? undefined : parseAndroidColor(raw);
  if (selection?.rgb !== ink.toUpperCase()) {
    findings.push(`${scheme}: android:textColorHighlight resolves to ${String(raw)}, not text ${ink} at some alpha`);
    return findings;
  }
  for (const canvas of ['bg', 'surface', 'sheet'] as const) {
    const under = COLORS[scheme][canvas];
    const painted = mixHex(selection.rgb, under, selection.alpha);
    const readable = contrastRatio(ink, painted);
    const visible = contrastRatio(painted, under);
    if (readable < READABLE) findings.push(`${scheme}: selected text on ${canvas} is ${readable.toFixed(2)}:1, under ${READABLE}:1`);
    if (visible < VISIBLE) findings.push(`${scheme}: the selection on ${canvas} is ${visible.toFixed(2)}:1 from it, under ${VISIBLE}:1`);
  }
  return findings;
}

/** The values files `scheme` resolves, most specific last (a later file's colour wins). */
function valueFiles(scheme: Scheme): string[] {
  const dirs = scheme === 'light' ? [VALUES_DIR.light] : [VALUES_DIR.light, VALUES_DIR.dark];
  return dirs.flatMap((dir) =>
    fs
      .readdirSync(path.join(RES_DIR, dir))
      .filter((f) => f.endsWith('.xml'))
      .map((f) => fs.readFileSync(path.join(RES_DIR, dir, f), 'utf8')),
  );
}

export async function run(): Promise<void> {
  const styles = fs.readFileSync(path.join(RES_DIR, 'values/styles.xml'), 'utf8');

  await test('android accent: in both schemes AppTheme’s caret is the token `text` and its selection a readable ink highlight', () => {
    const findings = SCHEMES.flatMap((scheme) => androidAccentFindings(scheme, styles, valueFiles(scheme)));
    assert(findings.length === 0, findings.join('; '));
  });

  await test('androidAccentFindings: a light caret left in dark, a teal highlight, an opaque highlight, or no colours at all, fail', () => {
    const noNight = valueFiles('light');
    assert(
      androidAccentFindings('dark', styles, noNight).some((f) => f.startsWith('dark: colorAccent')),
      'dark mode resolving the light caret (no values-night override) is caught',
    );
    const teal = valueFiles('light').map((xml) => xml.replace(/(<color name="whim_selection">)#[0-9a-fA-F]+/, '$1#4D008577'));
    assert(androidAccentFindings('light', styles, teal).some((f) => f.includes('textColorHighlight')), 'a highlight in another hue is caught');
    const opaque = valueFiles('dark').map((xml) => xml.replace(/(<color name="whim_selection">)#[0-9a-fA-F]+/, '$1#FFF2F0EC'));
    assert(androidAccentFindings('dark', styles, opaque).some((f) => f.includes('selected text on bg')), 'an opaque ink highlight that hides the text is caught');
    const faint = valueFiles('light').map((xml) => xml.replace(/(<color name="whim_selection">)#[0-9a-fA-F]+/, '$1#051A1614'));
    assert(androidAccentFindings('light', styles, faint).some((f) => f.includes('the selection on bg')), 'a highlight too faint to see is caught');
    const unthemed = styles
      .split('\n')
      .filter((line) => !line.includes('<item name="colorAccent">') && !line.includes('<item name="android:textColorHighlight">'))
      .join('\n');
    assert(androidAccentFindings('light', unthemed, valueFiles('light')).length === 2, 'a theme that sets neither colour is caught twice');
  });
}
