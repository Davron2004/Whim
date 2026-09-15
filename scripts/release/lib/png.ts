/**
 * A minimal, zlib-only PNG codec (design D10; task 7.2). Node's `node:zlib` (deflate/inflate/
 * crc32) is the only dependency — no image library, no native addon.
 *
 * `readPngInfo` reads just the IHDR chunk (width, height, bit depth, color type, alpha).
 * `decodeRgba8` unfilters an 8-bit RGB or RGBA (color type 2 or 6) image into RGBA8 pixels,
 * covering all five PNG filter types (0 None, 1 Sub, 2 Up, 3 Average, 4 Paeth). `encodeRgb8`
 * writes an 8-bit RGB (color type 2, no alpha channel) image using filter type None on every
 * scanline and a fixed deflate level, so the same input pixels always produce the same file
 * bytes — `scripts/release/lib/assets.ts` relies on that determinism.
 */

import type { Buffer as NodeBuffer } from 'buffer';

interface ZlibModule {
  deflateSync(data: Uint8Array, options?: { readonly level?: number }): NodeBuffer;
  inflateSync(data: Uint8Array): NodeBuffer;
  crc32(data: Uint8Array): number;
}

// `node:zlib` is a real Node builtin (esbuild always externalizes builtins under
// `platform: 'node'`, bundled or not), but this project ships no `@types/node` and TypeScript
// treats `zlib`/`node:zlib` — unlike most other builtins — as already known-but-unresolvable,
// so a fresh `declare module 'node:zlib'` anywhere in this program errors as an invalid
// augmentation. Loading it through a non-literal dynamic import sidesteps module-specifier
// resolution entirely: TS types the result `Promise<any>`, cast once here to `ZlibModule`, and
// the top-level `await` (this file's output is ESM) resolves it once before any exported
// function runs, so `readPngInfo`/`decodeRgba8`/`encodeRgb8` stay ordinary synchronous calls.
const ZLIB_MODULE_SPECIFIER: string = 'node:zlib';
const zlib = (await import(ZLIB_MODULE_SPECIFIER)) as ZlibModule;

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

interface Chunk {
  readonly type: string;
  readonly data: NodeBuffer;
}

function readChunks(buf: NodeBuffer): Chunk[] {
  if (buf.length < 8 || buf.compare(PNG_SIGNATURE, 0, 8, 0, 8) !== 0) {
    throw new Error('not a PNG file (bad signature)');
  }
  const chunks: Chunk[] = [];
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    chunks.push({ type, data: Buffer.from(buf.subarray(dataStart, dataStart + length)) });
    offset = dataStart + length + 4; // skip the trailing CRC
    if (type === 'IEND') break;
  }
  return chunks;
}

export interface PngInfo {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  readonly hasAlpha: boolean;
}

/** Reads width/height/bit depth/color type from a PNG's IHDR chunk. Throws on a non-PNG buffer. */
export function readPngInfo(buf: NodeBuffer): PngInfo {
  const ihdr = readChunks(buf).find((c) => c.type === 'IHDR');
  if (!ihdr) throw new Error('PNG has no IHDR chunk');
  const colorType = ihdr.data.readUInt8(9);
  return {
    width: ihdr.data.readUInt32BE(0),
    height: ihdr.data.readUInt32BE(4),
    bitDepth: ihdr.data.readUInt8(8),
    colorType,
    hasAlpha: colorType === 4 || colorType === 6,
  };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** The reconstructed byte for one of the five PNG filter types (0 None .. 4 Paeth). */
function unfilterByte(filterType: number, filtered: number, a: number, b: number, c: number): number {
  switch (filterType) {
    case 0:
      return filtered;
    case 1:
      return filtered + a;
    case 2:
      return filtered + b;
    case 3:
      return filtered + Math.floor((a + b) / 2);
    case 4:
      return filtered + paeth(a, b, c);
    default:
      throw new Error(`unsupported PNG filter type ${filterType}`);
  }
}

export interface DecodedRgba8 {
  readonly width: number;
  readonly height: number;
  /** `width*height*4` bytes, RGBA in row-major order, no padding. */
  readonly pixels: NodeBuffer;
}

/** Unfilters `width*height*bpp` raw (post-inflate) scanline bytes, covering all five PNG filter types. */
function unfilter(raw: NodeBuffer, width: number, height: number, bpp: number): NodeBuffer {
  const stride = width * bpp;
  const pixels = Buffer.alloc(height * stride);
  let srcOffset = 0;
  for (let row = 0; row < height; row++) {
    const filterType = raw.readUInt8(srcOffset);
    srcOffset += 1;
    const rowStart = row * stride;
    const prevRowStart = (row - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const filtered = raw.readUInt8(srcOffset + x);
      const a = x >= bpp ? pixels[rowStart + x - bpp] : 0;
      const b = row > 0 ? pixels[prevRowStart + x] : 0;
      const c = row > 0 && x >= bpp ? pixels[prevRowStart + x - bpp] : 0;
      // eslint-disable-next-line no-bitwise -- wrapping a PNG filter reconstruction to one byte, not a bitmask
      pixels[rowStart + x] = unfilterByte(filterType, filtered, a, b, c) & 0xff;
    }
    srcOffset += stride;
  }
  return pixels;
}

/**
 * Decodes an 8-bit RGBA (color type 6) or RGB (color type 2) PNG into raw RGBA8 pixels,
 * unfiltering all five PNG filter types. A color type 2 source (Chromium's screenshot encoder
 * emits this whenever nothing in the viewport is actually transparent, even with
 * `omitBackground: true`) is returned with a synthesized, fully-opaque alpha channel, so
 * callers always get one consistent RGBA8 shape regardless of which one Chromium produced.
 */
export function decodeRgba8(buf: NodeBuffer): DecodedRgba8 {
  const chunks = readChunks(buf);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr) throw new Error('PNG has no IHDR chunk');
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data.readUInt8(8);
  const colorType = ihdr.data.readUInt8(9);
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`decodeRgba8 only supports 8-bit RGB or RGBA (color type 2 or 6); got bit depth ${bitDepth}, color type ${colorType}`);
  }

  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const raw = zlib.inflateSync(idat);

  if (colorType === 6) {
    return { width, height, pixels: unfilter(raw, width, height, 4) };
  }
  const rgb = unfilter(raw, width, height, 3);
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0, p = 0; p < rgb.length; i += 4, p += 3) {
    pixels[i] = rgb[p];
    pixels[i + 1] = rgb[p + 1];
    pixels[i + 2] = rgb[p + 2];
    pixels[i + 3] = 255;
  }
  return { width, height, pixels };
}

function chunk(type: string, data: NodeBuffer): NodeBuffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  // eslint-disable-next-line no-bitwise -- coercing crc32's signed int32 to an unsigned CRC value, not a bitmask
  const crcValue = zlib.crc32(typeAndData) >>> 0;
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crcValue, 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function encode(width: number, height: number, pixels: NodeBuffer, bpp: number, colorType: 2 | 6): NodeBuffer {
  const stride = width * bpp;
  if (pixels.length !== stride * height) {
    throw new Error(`encode: expected ${stride * height} bytes for ${width}x${height} at ${bpp} bytes/pixel, got ${pixels.length}`);
  }
  const raw = Buffer.alloc(height * (stride + 1));
  for (let row = 0; row < height; row++) {
    raw[row * (stride + 1)] = 0; // filter type None
    pixels.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  }

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // bit depth
  ihdrData.writeUInt8(colorType, 9);
  ihdrData.writeUInt8(0, 10); // compression method
  ihdrData.writeUInt8(0, 11); // filter method
  ihdrData.writeUInt8(0, 12); // interlace method (no interlacing)

  const idatData = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdrData), chunk('IDAT', idatData), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Encodes an 8-bit RGB (color type 2, no alpha) PNG from raw `width*height*3` RGB bytes.
 * Every scanline is written with filter type None and deflated at a fixed level, so the same
 * pixels always produce the same file bytes (no timestamp or OS chunk is ever written).
 */
export function encodeRgb8(width: number, height: number, rgb: NodeBuffer): NodeBuffer {
  return encode(width, height, rgb, 3, 2);
}

/**
 * Encodes an 8-bit RGBA (color type 6) PNG from raw `width*height*4` RGBA bytes, with the same
 * filter-type-None, fixed-deflate-level determinism as `encodeRgb8`. `generateAssets` uses this
 * for every alpha-keeping output instead of writing Chromium's screenshot bytes directly,
 * because Chromium's own PNG encoder silently drops to color type 2 whenever a render happens
 * to be fully opaque (no pixel actually needs the channel) — this way alpha:true outputs always
 * carry the channel design D10's output table requires, dropped pixels or not.
 */
export function encodeRgba8(width: number, height: number, rgba: NodeBuffer): NodeBuffer {
  return encode(width, height, rgba, 4, 6);
}
