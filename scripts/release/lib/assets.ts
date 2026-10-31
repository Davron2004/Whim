/**
 * The brand-asset generator (design D10; task 7.3; design-system-v1 D12). `generateAssets(repoRoot)`
 * renders every icon and launch asset from one SVG or PNG foreground + `release/assets/brand.json`
 * through Playwright's Chromium — the mark on the warm-dark icon background, the mark alone, its
 * monochrome silhouette and its tinted grey — composites the outputs whose format forbids alpha,
 * writes the light and dark launch backgrounds for both platforms, and writes
 * `release/assets/generated.json`. `checkAssets(repoRoot)` re-hashes everything, reads PNG headers
 * and holds brand.json and the mark to the design tokens — it never touches Playwright (chains.md:
 * suites never shell out to it), so it alone is safe for `checks/test/release/assets.suite.ts` to
 * import.
 */

import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { Buffer as NodeBuffer } from 'buffer';
import { readPngInfo, decodeRgba8, encodeRgb8, encodeRgba8 } from './png';
import { COLORS, SCHEMES, type Scheme } from '../../../src/design/tokens';
import { EMBER_PATH } from '../../../src/design/icons/ember';

// Merges additively with `scripts/release/env.d.ts` (handoff/release-tooling.md) — this file
// owns only the fs/crypto slice it uses beyond what that file and native-config.ts declare.
declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options: { recursive: true }): string | undefined;
  export function writeFileSync(path: string, data: NodeBuffer): void;
}
declare module 'node:crypto' {
  export interface Hash {
    update(data: NodeBuffer): Hash;
    digest(encoding: 'hex'): string;
  }
  export function createHash(algorithm: 'sha256'): Hash;
}

export const BRAND_JSON_PATH = 'release/assets/brand.json';
export const ICON_FOREGROUND_SVG_PATH = 'release/assets/icon-foreground.svg';
export const ICON_FOREGROUND_PNG_PATH = 'release/assets/icon-foreground.png';
export const GENERATED_JSON_PATH = 'release/assets/generated.json';
export const GENERATE_ASSETS_COMMAND = 'node scripts/release/run.mjs generate-assets';

/** `release/assets/brand.json`: the icon's warm-dark background, a vertical gradient (system.md
 *  §3.3), and the launch background per scheme, which must equal each scheme's `bg` token. */
export interface Brand {
  readonly iconBackground: { readonly top: string; readonly bottom: string };
  readonly launchBackground: Readonly<Record<Scheme, string>>;
}

/** How an output draws the mark: on the icon background (`square`, `circle`, `feature`), alone on
 *  transparency (`mark`), as a white silhouette on transparency (`monochrome`, Android's themed
 *  icon), or grey on black (`tinted`, iOS's tinted icon). */
export type AssetKind = 'square' | 'circle' | 'feature' | 'mark' | 'monochrome' | 'tinted';

/** One row of design D10's output table: where it goes, its required pixel size, whether it
 *  keeps an alpha channel, and how its background/mark are composed (see `markHtml` below). */
export interface AssetSpec {
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly alpha: boolean;
  readonly kind: AssetKind;
}

const ANDROID_DENSITIES: readonly { readonly suffix: string; readonly scale: number }[] = [
  { suffix: 'mdpi', scale: 1 },
  { suffix: 'hdpi', scale: 1.5 },
  { suffix: 'xhdpi', scale: 2 },
  { suffix: 'xxhdpi', scale: 3 },
  { suffix: 'xxxhdpi', scale: 4 },
];

function androidLegacyIcons(): AssetSpec[] {
  const specs: AssetSpec[] = [];
  for (const { suffix, scale } of ANDROID_DENSITIES) {
    const size = Math.round(48 * scale);
    specs.push({ path: `android/app/src/main/res/mipmap-${suffix}/ic_launcher.png`, width: size, height: size, alpha: true, kind: 'square' });
    specs.push({ path: `android/app/src/main/res/mipmap-${suffix}/ic_launcher_round.png`, width: size, height: size, alpha: true, kind: 'circle' });
  }
  return specs;
}

function androidAdaptiveLayers(): AssetSpec[] {
  const specs: AssetSpec[] = [];
  for (const { suffix, scale } of ANDROID_DENSITIES) {
    const size = Math.round(108 * scale);
    specs.push({
      path: `android/app/src/main/res/mipmap-${suffix}/ic_launcher_foreground.png`,
      width: size,
      height: size,
      alpha: true,
      kind: 'mark',
    });
    specs.push({
      path: `android/app/src/main/res/mipmap-${suffix}/ic_launcher_monochrome.png`,
      width: size,
      height: size,
      alpha: true,
      kind: 'monochrome',
    });
  }
  return specs;
}

/** The launch mark's size in pt/dp: the mark's 48 grid fills half the source, so the ember draws
 *  at 128, its launch size (system.md §3.3). */
const LAUNCH_MARK_SIZE = 256;

function androidLaunchMarks(): AssetSpec[] {
  return ANDROID_DENSITIES.map(({ suffix, scale }) => ({
    path: `android/app/src/main/res/drawable-${suffix}/launch_mark.png`,
    width: Math.round(LAUNCH_MARK_SIZE * scale),
    height: Math.round(LAUNCH_MARK_SIZE * scale),
    alpha: true,
    kind: 'mark' as const,
  }));
}

function iosLaunchMarks(): AssetSpec[] {
  return [1, 2, 3].map((scale) => ({
    path: `ios/Whim/Images.xcassets/LaunchMark.imageset/LaunchMark${scale === 1 ? '' : '@' + String(scale) + 'x'}.png`,
    width: LAUNCH_MARK_SIZE * scale,
    height: LAUNCH_MARK_SIZE * scale,
    alpha: true,
    kind: 'mark' as const,
  }));
}

/** Design D10's output table, as data. Every image `generateAssets` writes and `checkAssets`
 *  verifies — required size and alpha are read from here, never from `generated.json` (which
 *  only carries hashes for staleness detection). */
export const ASSET_TABLE: readonly AssetSpec[] = [
  { path: 'ios/Whim/Images.xcassets/AppIcon.appiconset/AppIcon-1024.png', width: 1024, height: 1024, alpha: false, kind: 'square' },
  // iOS 18 appearances: dark is the mark on transparency (the system draws its dark backdrop),
  // tinted a grey mark on black (the system tints by luminance).
  { path: 'ios/Whim/Images.xcassets/AppIcon.appiconset/AppIcon-1024-dark.png', width: 1024, height: 1024, alpha: true, kind: 'mark' },
  { path: 'ios/Whim/Images.xcassets/AppIcon.appiconset/AppIcon-1024-tinted.png', width: 1024, height: 1024, alpha: false, kind: 'tinted' },
  ...iosLaunchMarks(),
  ...androidLegacyIcons(),
  ...androidAdaptiveLayers(),
  ...androidLaunchMarks(),
  { path: 'release/store/play/en-US/images/icon.png', width: 512, height: 512, alpha: true, kind: 'square' },
  { path: 'release/store/play/en-US/images/featureGraphic.png', width: 1024, height: 500, alpha: false, kind: 'feature' },
];

/** Non-pixel outputs: still recorded in `generated.json` for staleness detection, but they have
 *  no required size/alpha to check — only existence and hash. */
const NON_IMAGE_OUTPUTS: readonly string[] = [
  'ios/Whim/Images.xcassets/AppIcon.appiconset/Contents.json',
  'ios/Whim/Images.xcassets/LaunchMark.imageset/Contents.json',
  'ios/Whim/Images.xcassets/LaunchBackground.colorset/Contents.json',
  'android/app/src/main/res/values/brand_colors.xml',
  'android/app/src/main/res/values-night/brand_colors.xml',
  'android/app/src/main/res/drawable/ic_launcher_background.xml',
  'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml',
  'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml',
];

export interface GeneratedOutput {
  readonly path: string;
  readonly sha256: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly alpha: boolean | null;
}

/** `release/assets/generated.json`'s exact schema (handoff/brand-assets.md). */
export interface GeneratedAssetsFile {
  readonly version: 1;
  readonly source: { readonly path: string; readonly sha256: string };
  readonly brand: { readonly path: string; readonly sha256: string };
  readonly outputs: readonly GeneratedOutput[];
}

function hexToRgb(hex: string): readonly [number, number, number] {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) throw new Error(`expected a 6-digit hex color, got ${JSON.stringify(hex)}`);
  const n = parseInt(m[1], 16);
  // eslint-disable-next-line no-bitwise -- splitting a packed 24-bit hex color into its R/G/B bytes
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Alpha-blends RGBA pixels over a flat hex background, dropping the alpha channel. */
function compositeOverBackground(decoded: { readonly width: number; readonly height: number; readonly pixels: NodeBuffer }, bgHex: string): NodeBuffer {
  const [br, bgc, bb] = hexToRgb(bgHex);
  const out = Buffer.alloc(decoded.width * decoded.height * 3);
  for (let i = 0, p = 0; i < decoded.pixels.length; i += 4, p += 3) {
    const a = decoded.pixels[i + 3] / 255;
    out[p] = Math.round(decoded.pixels[i] * a + br * (1 - a));
    out[p + 1] = Math.round(decoded.pixels[i + 1] * a + bgc * (1 - a));
    out[p + 2] = Math.round(decoded.pixels[i + 2] * a + bb * (1 - a));
  }
  return out;
}

interface Background {
  readonly css: string;
  readonly shape: 'square' | 'circle';
}

/** The CSS of the warm-dark icon background, top to bottom (the mockup's `linear-gradient`). */
function iconBackgroundCss(brand: Brand): string {
  return `linear-gradient(${brand.iconBackground.top},${brand.iconBackground.bottom})`;
}

/** The layer behind the mark: none for the transparent kinds, black for the tinted icon, a square
 *  or circle of the icon background for everything else. */
function backgroundFor(spec: AssetSpec, brand: Brand): Background | null {
  if (spec.kind === 'mark' || spec.kind === 'monochrome') return null;
  if (spec.kind === 'tinted') return { css: '#000000', shape: 'square' };
  return { css: iconBackgroundCss(brand), shape: spec.kind === 'circle' ? 'circle' : 'square' };
}

/** The colour an output without alpha is flattened onto (only pixels the render left
 *  transparent take it). */
function flattenColor(spec: AssetSpec, brand: Brand): string {
  return spec.kind === 'tinted' ? '#000000' : brand.iconBackground.bottom;
}

/** The variant styles an SVG source gets, by its classes: the monochrome silhouette drops the
 *  light around the mark (`glow`) and fills the mark (`mark`) white. */
const SVG_VARIANT_STYLE: Partial<Record<AssetKind, string>> = {
  monochrome: '.glow{display:none}.mark{fill:#FFFFFF}',
};

/** The CSS filter every source gets per kind: monochrome turns whatever is drawn white (keeping
 *  its alpha), tinted turns it grey. */
const VARIANT_FILTER: Partial<Record<AssetKind, string>> = {
  monochrome: 'brightness(0) invert(1)',
  tinted: 'grayscale(1)',
};

/** The source as a data URI for `kind`: an SVG gets the kind's variant stylesheet. */
function sourceDataUriFor(source: { readonly bytes: NodeBuffer; readonly svg: boolean }, kind: AssetKind): string {
  if (!source.svg) return `data:image/png;base64,${source.bytes.toString('base64')}`;
  const style = SVG_VARIANT_STYLE[kind];
  const text = source.bytes.toString('utf8');
  const svg = style === undefined ? text : text.replace(/<svg\b[^>]*>/, (open) => `${open}<style>${style}</style>`);
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

function markHtml(
  sourceDataUri: string,
  canvasWidth: number,
  canvasHeight: number,
  background: Background | null,
  markSize: number,
  filter: string | undefined,
): string {
  const markLeft = (canvasWidth - markSize) / 2;
  const markTop = (canvasHeight - markSize) / 2;
  let bgDiv = '';
  if (background) {
    const borderRadius = background.shape === 'circle' ? 'border-radius:50%;' : '';
    bgDiv = `<div style="position:absolute;left:0;top:0;width:${canvasWidth}px;height:${canvasHeight}px;background:${background.css};${borderRadius}"></div>`;
  }
  const filterCss = filter === undefined ? '' : `filter:${filter};`;
  return `<!doctype html><html><head><style>html,body{margin:0;padding:0;background:transparent;width:${canvasWidth}px;height:${canvasHeight}px;overflow:hidden;}</style></head><body>${bgDiv}<img src="${sourceDataUri}" width="${markSize}" height="${markSize}" style="position:absolute;left:${markLeft}px;top:${markTop}px;display:block;${filterCss}"></body></html>`;
}

// Kept out of a static `import` so `checks/test/run.mjs`'s esbuild bundle (unlike
// `scripts/release/run.mjs`, it has no `external: ['playwright']`) never has to resolve
// Playwright's driver — `checkAssets`/`readPngInfo`, the only things `assets.suite.ts` calls,
// never reach this function. A non-literal specifier stops esbuild from bundling it as a
// static or dynamic import; Node resolves it from `node_modules` at actual call time instead.
const PLAYWRIGHT_MODULE = 'playwright';

interface MiniPlaywrightPage {
  setContent(html: string): Promise<void>;
  screenshot(options: { omitBackground: boolean }): Promise<NodeBuffer>;
  close(): Promise<void>;
}
interface MiniPlaywrightBrowser {
  newPage(options: { viewport: { width: number; height: number } }): Promise<MiniPlaywrightPage>;
  close(): Promise<void>;
}
interface MiniPlaywright {
  readonly chromium: { launch(options: { headless: boolean }): Promise<MiniPlaywrightBrowser> };
}

async function renderPng(html: string, width: number, height: number): Promise<NodeBuffer> {
  const { chromium } = (await import(PLAYWRIGHT_MODULE)) as MiniPlaywright;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    try {
      await page.setContent(html);
      return await page.screenshot({ omitBackground: true });
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

function writeOutput(repoRoot: string, relPath: string, data: NodeBuffer): void {
  const abs = path.join(repoRoot, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, data);
}

function sha256File(absPath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
}

const APPICON_CONTENTS_JSON = `${JSON.stringify(
  {
    images: [
      { filename: 'AppIcon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
      { appearances: [{ appearance: 'luminosity', value: 'dark' }], filename: 'AppIcon-1024-dark.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
      { appearances: [{ appearance: 'luminosity', value: 'tinted' }], filename: 'AppIcon-1024-tinted.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
    ],
    info: { author: 'xcode', version: 1 },
  },
  null,
  2,
)}\n`;

const LAUNCHMARK_CONTENTS_JSON = `${JSON.stringify(
  {
    images: [
      { filename: 'LaunchMark.png', idiom: 'universal', scale: '1x' },
      { filename: 'LaunchMark@2x.png', idiom: 'universal', scale: '2x' },
      { filename: 'LaunchMark@3x.png', idiom: 'universal', scale: '3x' },
    ],
    info: { author: 'xcode', version: 1 },
  },
  null,
  2,
)}\n`;

/** The launch background colour set: the light `bg`, and the dark `bg` for the dark appearance. */
function launchBackgroundContentsJson(launch: Brand['launchBackground']): string {
  const color = (hex: string) => {
    const [r, g, b] = hexToRgb(hex);
    const component = (n: number): string => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;
    return { 'color-space': 'srgb', components: { red: component(r), green: component(g), blue: component(b), alpha: '1.000' } };
  };
  return `${JSON.stringify(
    {
      colors: [
        { color: color(launch.light), idiom: 'universal' },
        { appearances: [{ appearance: 'luminosity', value: 'dark' }], color: color(launch.dark), idiom: 'universal' },
      ],
      info: { author: 'xcode', version: 1 },
    },
    null,
    2,
  )}\n`;
}

/** `values/` (light) and `values-night/` (dark) each hold their scheme's launch background. */
function brandColorsXml(launchBackground: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="launch_background">${launchBackground}</color>\n</resources>\n`;
}

/** The adaptive icon's background layer: the warm-dark gradient, top to bottom. */
function iconBackgroundXml(brand: Brand): string {
  return `<?xml version="1.0" encoding="utf-8"?>\n<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">\n    <gradient android:angle="270" android:startColor="${brand.iconBackground.top}" android:endColor="${brand.iconBackground.bottom}"/>\n</shape>\n`;
}

const ADAPTIVE_ICON_XML = `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@drawable/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>\n</adaptive-icon>\n`;

/**
 * Renders every output in `ASSET_TABLE`, writes the non-pixel outputs (`Contents.json`
 * variants, `brand_colors.xml`, the two adaptive-icon XMLs), and writes
 * `release/assets/generated.json` (design D10 "The command"; specs/app-icon-and-launch/spec.md
 * "One command derives every icon and launch asset from one source").
 */
export async function generateAssets(repoRoot: string, render: typeof renderPng = renderPng): Promise<void> {
  const brandPath = path.join(repoRoot, BRAND_JSON_PATH);
  const brand = JSON.parse(fs.readFileSync(brandPath, 'utf8')) as Brand;
  const sourceFindings: AssetFinding[] = [];
  const sourcePath = checkSourceCount(repoRoot, sourceFindings);
  if (sourceFindings.length > 0) throw new Error(sourceFindings.map((finding) => finding.message).join('; '));
  const sourceBytes = fs.readFileSync(path.join(repoRoot, sourcePath));
  const source = { bytes: sourceBytes, svg: sourcePath === ICON_FOREGROUND_SVG_PATH };

  for (const spec of ASSET_TABLE) {
    const markSize = Math.min(spec.width, spec.height);
    const html = markHtml(sourceDataUriFor(source, spec.kind), spec.width, spec.height, backgroundFor(spec, brand), markSize, VARIANT_FILTER[spec.kind]);
    const rendered = await render(html, spec.width, spec.height);
    const info = readPngInfo(rendered);
    if (info.width !== spec.width || info.height !== spec.height) {
      throw new Error(`generateAssets: rendered ${spec.path} at ${info.width}x${info.height}, expected ${spec.width}x${spec.height}`);
    }
    // Always decode and re-encode ourselves (never write Chromium's screenshot bytes as-is):
    // Chromium's PNG encoder drops to color type 2 whenever nothing in the render is actually
    // transparent, so an alpha:true output (e.g. the legacy square icons, which ARE fully
    // opaque but still required to carry the channel) needs `encodeRgba8` to put it back.
    const decoded = decodeRgba8(rendered);
    const bytes = spec.alpha ? encodeRgba8(spec.width, spec.height, decoded.pixels) : encodeRgb8(spec.width, spec.height, compositeOverBackground(decoded, flattenColor(spec, brand)));
    writeOutput(repoRoot, spec.path, bytes);
  }

  writeOutput(repoRoot, 'ios/Whim/Images.xcassets/AppIcon.appiconset/Contents.json', Buffer.from(APPICON_CONTENTS_JSON, 'utf8'));
  writeOutput(repoRoot, 'ios/Whim/Images.xcassets/LaunchMark.imageset/Contents.json', Buffer.from(LAUNCHMARK_CONTENTS_JSON, 'utf8'));
  writeOutput(
    repoRoot,
    'ios/Whim/Images.xcassets/LaunchBackground.colorset/Contents.json',
    Buffer.from(launchBackgroundContentsJson(brand.launchBackground), 'utf8'),
  );
  writeOutput(repoRoot, 'android/app/src/main/res/values/brand_colors.xml', Buffer.from(brandColorsXml(brand.launchBackground.light), 'utf8'));
  writeOutput(repoRoot, 'android/app/src/main/res/values-night/brand_colors.xml', Buffer.from(brandColorsXml(brand.launchBackground.dark), 'utf8'));
  writeOutput(repoRoot, 'android/app/src/main/res/drawable/ic_launcher_background.xml', Buffer.from(iconBackgroundXml(brand), 'utf8'));
  writeOutput(repoRoot, 'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml', Buffer.from(ADAPTIVE_ICON_XML, 'utf8'));
  writeOutput(repoRoot, 'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml', Buffer.from(ADAPTIVE_ICON_XML, 'utf8'));

  const outputs: GeneratedOutput[] = [
    ...ASSET_TABLE.map((spec) => ({ path: spec.path, sha256: sha256File(path.join(repoRoot, spec.path)), width: spec.width, height: spec.height, alpha: spec.alpha })),
    ...NON_IMAGE_OUTPUTS.map((p) => ({ path: p, sha256: sha256File(path.join(repoRoot, p)), width: null, height: null, alpha: null })),
  ];
  const generated: GeneratedAssetsFile = {
    version: 1,
    source: { path: sourcePath, sha256: crypto.createHash('sha256').update(sourceBytes).digest('hex') },
    brand: { path: BRAND_JSON_PATH, sha256: sha256File(brandPath) },
    outputs,
  };
  writeOutput(repoRoot, GENERATED_JSON_PATH, Buffer.from(`${JSON.stringify(generated, null, 2)}\n`, 'utf8'));
}

export interface AssetFinding {
  readonly path: string;
  readonly message: string;
}

function checkOutputHash(repoRoot: string, findings: AssetFinding[], relPath: string, recorded: GeneratedOutput | undefined): void {
  const abs = path.join(repoRoot, relPath);
  if (recorded === undefined) {
    findings.push({ path: relPath, message: `${relPath} is not recorded in ${GENERATED_JSON_PATH}; run "${GENERATE_ASSETS_COMMAND}"` });
    return;
  }
  if (sha256File(abs) !== recorded.sha256) {
    findings.push({ path: relPath, message: `${relPath} does not match the hash recorded in ${GENERATED_JSON_PATH}; run "${GENERATE_ASSETS_COMMAND}"` });
  }
}

/** Which foreground source file exists, appending a finding if it's zero or two. */
function checkSourceCount(repoRoot: string, findings: AssetFinding[]): string {
  const svgExists = fs.existsSync(path.join(repoRoot, ICON_FOREGROUND_SVG_PATH));
  const pngExists = fs.existsSync(path.join(repoRoot, ICON_FOREGROUND_PNG_PATH));
  if (svgExists && pngExists) {
    findings.push({
      path: ICON_FOREGROUND_SVG_PATH,
      message: `both ${ICON_FOREGROUND_SVG_PATH} and ${ICON_FOREGROUND_PNG_PATH} exist; exactly one foreground source is allowed`,
    });
  }
  if (!svgExists && !pngExists) {
    findings.push({ path: ICON_FOREGROUND_SVG_PATH, message: `no foreground source found at ${ICON_FOREGROUND_SVG_PATH} or ${ICON_FOREGROUND_PNG_PATH}` });
  }
  return svgExists ? ICON_FOREGROUND_SVG_PATH : ICON_FOREGROUND_PNG_PATH;
}

function checkSourceAndBrandHashes(repoRoot: string, findings: AssetFinding[], sourcePath: string, generated: GeneratedAssetsFile): void {
  if (generated.source.path !== sourcePath) {
    findings.push({ path: sourcePath, message: `${GENERATED_JSON_PATH} records a different foreground source; run "${GENERATE_ASSETS_COMMAND}"` });
  }
  if (fs.existsSync(path.join(repoRoot, sourcePath)) && sha256File(path.join(repoRoot, sourcePath)) !== generated.source.sha256) {
    findings.push({ path: sourcePath, message: `${sourcePath} does not match ${GENERATED_JSON_PATH}'s recorded source hash; run "${GENERATE_ASSETS_COMMAND}"` });
  }
  if (fs.existsSync(path.join(repoRoot, BRAND_JSON_PATH)) && sha256File(path.join(repoRoot, BRAND_JSON_PATH)) !== generated.brand.sha256) {
    findings.push({ path: BRAND_JSON_PATH, message: `${BRAND_JSON_PATH} does not match ${GENERATED_JSON_PATH}'s recorded hash; run "${GENERATE_ASSETS_COMMAND}"` });
  }
}

function checkImageSpec(repoRoot: string, findings: AssetFinding[], spec: AssetSpec, recorded: GeneratedOutput | undefined): void {
  const abs = path.join(repoRoot, spec.path);
  if (!fs.existsSync(abs)) {
    findings.push({ path: spec.path, message: `${spec.path} is missing; run "${GENERATE_ASSETS_COMMAND}"` });
    return;
  }
  const info = readPngInfo(fs.readFileSync(abs));
  if (info.width !== spec.width || info.height !== spec.height) {
    findings.push({ path: spec.path, message: `${spec.path} is ${info.width}x${info.height}, expected ${spec.width}x${spec.height}` });
  }
  if (info.hasAlpha !== spec.alpha) {
    findings.push({
      path: spec.path,
      message: `${spec.path} ${info.hasAlpha ? 'carries an alpha channel' : 'has no alpha channel'}, expected alpha=${String(spec.alpha)}`,
    });
  }
  checkOutputHash(repoRoot, findings, spec.path, recorded);
}

function checkNonImageOutput(repoRoot: string, findings: AssetFinding[], outPath: string, recorded: GeneratedOutput | undefined): void {
  if (!fs.existsSync(path.join(repoRoot, outPath))) {
    findings.push({ path: outPath, message: `${outPath} is missing; run "${GENERATE_ASSETS_COMMAND}"` });
    return;
  }
  checkOutputHash(repoRoot, findings, outPath, recorded);
}

/** Each scheme's launch background must be that scheme's `bg` token (specs/app-icon-and-launch
 *  "Launch shows the ember on the scheme's canvas with no flash"). */
function checkBrandMatchesTokens(repoRoot: string, findings: AssetFinding[]): void {
  const brandAbs = path.join(repoRoot, BRAND_JSON_PATH);
  if (!fs.existsSync(brandAbs)) return;
  const brand = JSON.parse(fs.readFileSync(brandAbs, 'utf8')) as { readonly launchBackground?: Partial<Record<Scheme, unknown>> };
  for (const scheme of SCHEMES) {
    const value = brand.launchBackground?.[scheme];
    const token = COLORS[scheme].bg;
    if (typeof value !== 'string' || value.toUpperCase() !== token.toUpperCase()) {
      findings.push({
        path: BRAND_JSON_PATH,
        message: `${BRAND_JSON_PATH}'s launchBackground.${scheme} is ${JSON.stringify(value)}, but the ${scheme} bg token is ${JSON.stringify(token)}`,
      });
    }
  }
}

/** An SVG source's mark (its `class="mark"` path) must be the ember of the icon set
 *  (specs/app-icon-and-launch "The app icon is the ember on warm dark"). A PNG source can't be
 *  read back as a path and is left to review. */
function checkMarkIsEmber(repoRoot: string, findings: AssetFinding[], sourcePath: string): void {
  if (sourcePath !== ICON_FOREGROUND_SVG_PATH || !fs.existsSync(path.join(repoRoot, sourcePath))) return;
  const svg = fs.readFileSync(path.join(repoRoot, sourcePath), 'utf8');
  const mark = /<path\b[^>]*\bclass="mark"[^>]*>/.exec(svg)?.[0];
  const d = mark === undefined ? undefined : /\bd="([^"]*)"/.exec(mark)?.[1];
  if (d !== EMBER_PATH) {
    findings.push({
      path: sourcePath,
      message: `${sourcePath}'s mark (the class="mark" path) is not the ember: expected EMBER_PATH from src/design/icons/ember.ts, got ${JSON.stringify(d ?? null)}`,
    });
  }
}

/**
 * Re-hashes every output against `generated.json`, reads PNG headers for required size and
 * alpha (from `ASSET_TABLE`, not from `generated.json`), compares `brand.json`'s light and dark
 * `launchBackground` with the `bg` tokens and the SVG source's mark with the ember
 * (specs/app-icon-and-launch/spec.md "The checks detect stale, missing or mis-sized assets",
 * "Launch shows the ember on the scheme's canvas with no flash", "The app icon is the ember on
 * warm dark"). Every finding names its file.
 */
export function checkAssets(repoRoot: string): AssetFinding[] {
  const findings: AssetFinding[] = [];

  const sourcePath = checkSourceCount(repoRoot, findings);

  const generatedAbs = path.join(repoRoot, GENERATED_JSON_PATH);
  if (!fs.existsSync(generatedAbs)) {
    findings.push({ path: GENERATED_JSON_PATH, message: `${GENERATED_JSON_PATH} is missing; run "${GENERATE_ASSETS_COMMAND}"` });
    return findings;
  }
  const generated = JSON.parse(fs.readFileSync(generatedAbs, 'utf8')) as GeneratedAssetsFile;
  checkSourceAndBrandHashes(repoRoot, findings, sourcePath, generated);
  checkMarkIsEmber(repoRoot, findings, sourcePath);

  const recordedByPath = new Map(generated.outputs.map((o) => [o.path, o] as const));
  for (const spec of ASSET_TABLE) {
    checkImageSpec(repoRoot, findings, spec, recordedByPath.get(spec.path));
  }
  for (const outPath of NON_IMAGE_OUTPUTS) {
    checkNonImageOutput(repoRoot, findings, outPath, recordedByPath.get(outPath));
  }
  checkBrandMatchesTokens(repoRoot, findings);

  return findings;
}
