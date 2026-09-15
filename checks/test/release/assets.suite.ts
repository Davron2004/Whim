/**
 * Acceptance for `scripts/release/lib/{assets,png}.ts` (chain-6, platform-release-readiness).
 * specs/app-icon-and-launch/spec.md "One command derives every icon and launch asset from one
 * source", "The checks detect stale, missing or mis-sized assets", "Store-facing icons meet
 * each store's format rules", "The Android icon is adaptive with a legacy fallback", "Launch
 * shows the mark on the shell paper color with no flash"; task 7.5. Never imports Playwright
 * (chains.md: suites shell out to nothing but `git ls-files`) — `checkAssets`/`readPngInfo`
 * never touch it either.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { test, assert } from '../harness';
import { checkAssets, ASSET_TABLE, GENERATED_JSON_PATH, BRAND_JSON_PATH, ICON_FOREGROUND_SVG_PATH } from '../../../scripts/release/lib/assets';
import { readPngInfo, decodeRgba8, encodeRgb8, encodeRgba8 } from '../../../scripts/release/lib/png';

const REPO_ROOT = process.cwd();

/** The subtrees `checkAssets` reads. Copying just these (not the whole repo) keeps the fixture small. */
const RELEVANT_DIRS = [
  'release/assets',
  'release/store/play/en-US/images',
  'ios/Whim/Images.xcassets',
  'android/app/src/main/res',
];

function makeTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-assets-'));
  for (const rel of RELEVANT_DIRS) {
    fs.cpSync(path.join(REPO_ROOT, rel), path.join(dir, rel), { recursive: true });
  }
  return dir;
}

function readGenerated(dir: string): any {
  return JSON.parse(fs.readFileSync(path.join(dir, GENERATED_JSON_PATH), 'utf8'));
}

function writeGenerated(dir: string, generated: unknown): void {
  fs.writeFileSync(path.join(dir, GENERATED_JSON_PATH), `${JSON.stringify(generated, null, 2)}\n`);
}

function sha256(dir: string, relPath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, relPath))).digest('hex');
}

function findingsFor(findings: { path: string; message: string }[], relPath: string): { path: string; message: string }[] {
  return findings.filter((f) => f.path === relPath);
}

/** An independent reference implementation of the PNG Paeth predictor (spec Annex, not
 *  png.ts's own `paeth`), used to build a hand-filtered fixture the codec didn't produce. */
function referencePaeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** The filtered (not reconstructed) byte for one of the five PNG filter types — the inverse
 *  of what `unfilterByte` in png.ts computes, used to build a fixture with a known plaintext. */
function referenceFilter(filterType: number, cur: number, a: number, b: number, c: number): number {
  switch (filterType) {
    case 0:
      return cur;
    case 1:
      return cur - a;
    case 2:
      return cur - b;
    case 3:
      return cur - Math.floor((a + b) / 2);
    default:
      return cur - referencePaeth(a, b, c);
  }
}

/** A tiny valid RGBA8 PNG fixture built by hand (2x2), used to swap in a same-hash-but-wrong
 *  file — isolating the alpha/size checks from the hash check (the discriminating pattern). */
function makeRgbaFixture(width: number, height: number): Buffer {
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 200;
    pixels[i + 1] = 100;
    pixels[i + 2] = 50;
    pixels[i + 3] = 255; // fully opaque, but still color type 6 (alpha channel present)
  }
  return encodeRgba8(width, height, pixels);
}

export async function run(): Promise<void> {
  await test('checkAssets: the repo passes with no findings', () => {
    const findings = checkAssets(REPO_ROOT);
    assert(findings.length === 0, `expected no findings against the real repo, got ${JSON.stringify(findings)}`);
  });

  await test('checkAssets: the source mark edited without regenerating fails, naming the source file and the generate command', () => {
    const dir = makeTempRepo();
    try {
      fs.appendFileSync(path.join(dir, ICON_FOREGROUND_SVG_PATH), '<!-- edited -->\n');
      const hits = findingsFor(checkAssets(dir), ICON_FOREGROUND_SVG_PATH);
      assert(hits.length > 0, `expected a finding naming ${ICON_FOREGROUND_SVG_PATH}`);
      assert(
        hits.some((f) => /generate-assets/.test(f.message)),
        `expected the finding to name the generate command, got ${JSON.stringify(hits)}`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('checkAssets: a deleted density fails, naming that path', () => {
    const dir = makeTempRepo();
    try {
      const target = 'android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png';
      fs.rmSync(path.join(dir, target));
      const hits = findingsFor(checkAssets(dir), target);
      assert(hits.length > 0, `expected a finding naming ${target}, got ${JSON.stringify(checkAssets(dir))}`);
      assert(/missing/.test(hits[0].message), `expected the finding to say "missing", got ${hits[0].message}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('checkAssets: the iOS icon re-encoded with alpha fails on the alpha check alone (discriminating: hash is kept in sync)', () => {
    const dir = makeTempRepo();
    try {
      const target = 'ios/Whim/Images.xcassets/AppIcon.appiconset/AppIcon-1024.png';
      const withAlpha = makeRgbaFixture(1024, 1024);
      fs.writeFileSync(path.join(dir, target), withAlpha);
      // Keep generated.json's hash in sync with the swapped file, so a hash-only check
      // (the weaker variant) would NOT catch this — only the dedicated alpha check does.
      const generated = readGenerated(dir);
      const entry = generated.outputs.find((o: { path: string }) => o.path === target);
      entry.sha256 = sha256(dir, target);
      writeGenerated(dir, generated);

      const hits = findingsFor(checkAssets(dir), target);
      assert(hits.length > 0, `expected a finding naming ${target}`);
      assert(
        hits.some((f) => /alpha channel/.test(f.message)),
        `expected an alpha-channel finding, got ${JSON.stringify(hits)}`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('checkAssets: the feature graphic at the wrong size fails on the size check alone (discriminating: hash is kept in sync)', () => {
    const dir = makeTempRepo();
    try {
      const target = 'release/store/play/en-US/images/featureGraphic.png';
      const wrongSize = encodeRgb8(800, 400, Buffer.alloc(800 * 400 * 3));
      fs.writeFileSync(path.join(dir, target), wrongSize);
      const generated = readGenerated(dir);
      const entry = generated.outputs.find((o: { path: string }) => o.path === target);
      entry.sha256 = sha256(dir, target);
      writeGenerated(dir, generated);

      const hits = findingsFor(checkAssets(dir), target);
      assert(hits.length > 0, `expected a finding naming ${target}`);
      assert(
        hits.some((f) => /800x400/.test(f.message) && /1024x500/.test(f.message)),
        `expected a size finding naming both dimensions, got ${JSON.stringify(hits)}`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('checkAssets: brand.json disagreeing with SHELL_COLORS.paper fails, showing both values', () => {
    const dir = makeTempRepo();
    try {
      fs.writeFileSync(path.join(dir, BRAND_JSON_PATH), JSON.stringify({ iconBackground: '#3f3d8f', launchBackground: '#ffffff' }));
      const hits = findingsFor(checkAssets(dir), BRAND_JSON_PATH);
      const brandHit = hits.find((f) => /launchBackground/.test(f.message));
      assert(!!brandHit, `expected a launchBackground finding, got ${JSON.stringify(hits)}`);
      assert(brandHit!.message.includes('#ffffff') && brandHit!.message.includes('#fbfaf8'), `expected both values in the message, got ${brandHit!.message}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('checkAssets: ASSET_TABLE covers every output design D10 lists (spot check on count)', () => {
    // 1 AppIcon + 3 LaunchMark + (10 legacy + 10 adaptive + 5 launch_mark) + 2 store images
    assert(ASSET_TABLE.length === 31, `expected 31 image outputs, got ${ASSET_TABLE.length}`);
  });

  await test('png: an RGB8 encode reads back as color type 2 with the same pixels', () => {
    const width = 5;
    const height = 3;
    const rgb = Buffer.alloc(width * height * 3);
    for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 37) % 256;
    const png = encodeRgb8(width, height, rgb);
    const info = readPngInfo(png);
    assert(info.colorType === 2, `expected color type 2, got ${info.colorType}`);
    assert(!info.hasAlpha, 'expected no alpha');
    assert(info.width === width && info.height === height, `expected ${width}x${height}, got ${info.width}x${info.height}`);
    const decoded = decodeRgba8(png);
    for (let i = 0, p = 0; p < rgb.length; i += 4, p += 3) {
      assert(decoded.pixels[i] === rgb[p] && decoded.pixels[i + 1] === rgb[p + 1] && decoded.pixels[i + 2] === rgb[p + 2], `pixel mismatch at byte ${p}`);
      assert(decoded.pixels[i + 3] === 255, 'expected a synthesized opaque alpha byte');
    }
  });

  await test('png: decoding an RGBA fixture that exercises every filter type round-trips exactly', () => {
    // Hand-build a small RGBA8 PNG whose 4 scanlines use filter types 0/1/2/3/4 in turn by
    // encoding once (filter type None) and then re-filtering the raw bytes ourselves before
    // re-inflating through decodeRgba8 — simplest is to just decode our own encodeRgba8
    // output (filter type None, exercising case 0) plus a synthetic multi-filter buffer.
    const width = 4;
    const height = 5; // 5 rows, one per filter type
    const pixels = Buffer.alloc(width * height * 4);
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 53 + 7) % 256;
    const png = encodeRgba8(width, height, pixels);
    const decoded = decodeRgba8(png);
    assert(decoded.pixels.equals(pixels), 'expected the round-tripped pixels to equal the source (filter type None)');

    // Build a raw (post-inflate) buffer that uses all five filter types across 5 rows, and
    // confirm decodeRgba8 unfilters each one back to the same reference pixels.
    const bpp = 4;
    const stride = width * bpp;
    const reference = Buffer.alloc(height * stride);
    for (let i = 0; i < reference.length; i++) reference[i] = (i * 91 + 3) % 256;
    const rawRows: number[][] = [];
    for (let row = 0; row < height; row++) {
      const filterType = row; // 0..4, one of each
      const out: number[] = [filterType];
      for (let x = 0; x < stride; x++) {
        const cur = reference[row * stride + x];
        const a = x >= bpp ? reference[row * stride + x - bpp] : 0;
        const b = row > 0 ? reference[(row - 1) * stride + x] : 0;
        const c = row > 0 && x >= bpp ? reference[(row - 1) * stride + x - bpp] : 0;
        // eslint-disable-next-line no-bitwise -- wrapping a PNG filter byte to one byte, not a bitmask
        out.push(referenceFilter(filterType, cur, a, b, c) & 0xff);
      }
      rawRows.push(out);
    }
    const raw = Buffer.from(rawRows.flat());
    const idat = zlib.deflateSync(raw);
    // Splice a PNG together by hand (signature + IHDR + IDAT + IEND) around our hand-filtered
    // IDAT payload, mirroring what `encode()` in png.ts does internally.
    const chunk = (type: string, data: Buffer): Buffer => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length, 0);
      const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
      const crcBuf = Buffer.alloc(4);
      // eslint-disable-next-line no-bitwise -- coercing crc32's signed int32 to an unsigned CRC value, not a bitmask
      crcBuf.writeUInt32BE(zlib.crc32(typeAndData) >>> 0, 0);
      return Buffer.concat([len, typeAndData, crcBuf]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr.writeUInt8(8, 8);
    ihdr.writeUInt8(6, 9);
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const handBuilt = Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);

    const decodedAllFilters = decodeRgba8(handBuilt);
    assert(decodedAllFilters.pixels.equals(reference), 'expected all five filter types to unfilter back to the reference pixels');
  });
}
