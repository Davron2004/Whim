# brand-assets (chain-6 → chain-7, chain-9, chain-10)

## Resource names chain-7 (launch wiring) reads

- iOS: `AppIcon` (single-size, 1024×1024, no alpha), `LaunchMark` image set (160/320/480pt,
  the mark inside an `iconBackground`-filled circle, alpha kept), `LaunchBackground` color set.
- Android: `@color/ic_launcher_background`, `@color/launch_background`
  (`android/app/src/main/res/values/brand_colors.xml`), `@drawable/launch_mark` (one PNG per
  density under `res/drawable-{m,h,xh,xxh,xxxh}dpi/`, no XML wrapper — Android picks by
  bucket), `@mipmap/ic_launcher`, `@mipmap/ic_launcher_round` (legacy, every density),
  `@mipmap/ic_launcher_foreground`, `@mipmap/ic_launcher_monochrome` (adaptive layers, every
  density), and the two `res/mipmap-anydpi-v26/{ic_launcher,ic_launcher_round}.xml` adaptive
  definitions (identical content — both reference the same background/foreground/monochrome).

## `release/assets/generated.json` schema (verbatim)

```ts
interface GeneratedOutput {
  readonly path: string;         // repo-relative
  readonly sha256: string;
  readonly width: number | null;  // null for non-image outputs (Contents.json, xml, ...)
  readonly height: number | null;
  readonly alpha: boolean | null;
}
interface GeneratedAssetsFile {
  readonly version: 1;
  readonly source: { readonly path: string; readonly sha256: string }; // whichever of
    // release/assets/icon-foreground.{svg,png} exists
  readonly brand: { readonly path: string; readonly sha256: string };  // release/assets/brand.json
  readonly outputs: readonly GeneratedOutput[]; // every file generateAssets writes, images and non-images
}
```

`checkAssets` does **not** trust `generated.json` for required width/height/alpha — those come
from the hardcoded `ASSET_TABLE` in `scripts/release/lib/assets.ts` (design D10's output table,
31 image entries). `generated.json` is only used to detect a stale/hand-edited file (hash
mismatch) and to enumerate every output for existence checks.

## `scripts/release/lib/assets.ts` / `png.ts`

```ts
// assets.ts
export type AssetKind = 'square' | 'circle' | 'foreground' | 'feature';
export interface AssetSpec { readonly path: string; readonly width: number; readonly height: number; readonly alpha: boolean; readonly kind: AssetKind; }
export const ASSET_TABLE: readonly AssetSpec[]; // 31 entries, the design D10 output table
export const BRAND_JSON_PATH = 'release/assets/brand.json';
export const GENERATED_JSON_PATH = 'release/assets/generated.json';
export const GENERATE_ASSETS_COMMAND = 'node scripts/release/run.mjs generate-assets';
export async function generateAssets(repoRoot: string): Promise<void>;
export interface AssetFinding { readonly path: string; readonly message: string; }
export function checkAssets(repoRoot: string): AssetFinding[]; // [] means pass, every finding names its file

// png.ts
export interface PngInfo { readonly width: number; readonly height: number; readonly bitDepth: number; readonly colorType: number; readonly hasAlpha: boolean; }
export function readPngInfo(buf: Buffer): PngInfo;
export function decodeRgba8(buf: Buffer): { readonly width: number; readonly height: number; readonly pixels: Buffer }; // accepts color type 2 or 6, always returns RGBA8
export function encodeRgb8(width: number, height: number, rgb: Buffer): Buffer;   // color type 2, no alpha
export function encodeRgba8(width: number, height: number, rgba: Buffer): Buffer; // color type 6
```

`generateAssets` always decodes Chromium's screenshot through `decodeRgba8` and re-encodes
through `encodeRgb8`/`encodeRgba8` itself — it never writes Chromium's PNG bytes as-is, because
Chromium's own encoder silently drops to color type 2 (no alpha) whenever a render happens to be
fully opaque, which would violate `alpha: true` table entries like the legacy square icons.

## Generate command

```
node scripts/release/run.mjs generate-assets
```

Renders every `ASSET_TABLE` entry from `release/assets/icon-foreground.svg` (or `.png`) +
`release/assets/brand.json` through Playwright's Chromium (headless, one page per output,
`omitBackground: true`), writes every PNG plus the non-image outputs (three `Contents.json`
files, `brand_colors.xml`, the two adaptive-icon XMLs), then `generated.json`. Verified
byte-identical across repeated runs (filter-type-None + fixed deflate level in `png.ts`, no
timestamp/OS chunk). Commit every output after running it.

## Playwright import — read before touching either file

`scripts/release/run.mjs` bundles `cli.ts` with `external: ['playwright']`, but
`checks/test/run.mjs` (which bundles `assets.suite.ts`) has no such exclusion and cannot bundle
Playwright's driver at all (`chromium-bidi` subpath resolution fails, `fsevents.node` has no
loader). `assets.ts` loads it as `await import(PLAYWRIGHT_MODULE)` where `PLAYWRIGHT_MODULE` is
a `string`-typed (not literal-typed) local — esbuild cannot statically resolve a non-literal
dynamic import specifier, so it leaves the `import()` call for Node to resolve at actual call
time. `checkAssets`/`readPngInfo`, the only things the suite calls, never reach that function, so
the suite never needs Playwright resolvable at all. Never turn `PLAYWRIGHT_MODULE` back into a
string literal or a static `import` — either bundles fine in isolation but breaks the suite.

## `node:zlib` typing gotcha

This project ships no `@types/node`, and unlike most Node builtins (`fs`, `path`,
`child_process`, `crypto`), TypeScript treats `zlib`/`node:zlib` specifically as
already-known-but-unresolvable — a fresh `declare module 'node:zlib'` anywhere in the program
errors `TS2664 Invalid module name in augmentation`, even from a file that doesn't import it
(measured; `os`, `url`, `dgram` don't have this problem, `v8`/`util`/`stream`/`events`/`assert`/
`querystring` do). `png.ts` loads it the same way as Playwright above — a non-literal dynamic
import, resolved once via a top-level `await` (this file's build output is ESM) and cast to a
local `ZlibModule` interface — so `readPngInfo`/`decodeRgba8`/`encodeRgb8`/`encodeRgba8` stay
ordinary synchronous functions. Do not attempt a `declare module 'node:zlib'` fragment again.
