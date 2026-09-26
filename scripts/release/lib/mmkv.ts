/**
 * Reads a react-native-mmkv store from the two files MMKV keeps on the device. The upgrade check
 * pulls the launcher's `whim.launcher` store with the app stopped, and `upgrade-record.ts` reads
 * it (beta-1 design D15).
 *
 * The layout MMKV 2.x writes, measured on a Whim install (meta version 4):
 *   `<id>.crc` (meta): u32le crc32 of the data region, u32le version, u32le sequence, a 16-byte
 *     IV, then u32le actualSize (the data region's length; meta version 3 and later).
 *   `<id>` (data): 4 bytes this meta version doesn't use, then the data region: one varint
 *     placeholder, then items, each a varint key length, the key (utf8), a varint value length and
 *     the value. A later item overrides an earlier one with the same key, and an empty value is a
 *     deleted key. Bytes past the region are stale leftovers from an earlier, longer write.
 *   A string value carries its own varint byte length before the utf8 bytes.
 *
 * Anything that doesn't fit this layout (a crc mismatch, an older meta version, an item that runs
 * past the region, a value that isn't a string) throws an error naming the store, so the check
 * fails rather than misreading the store.
 */

import type { Buffer as NodeBuffer } from 'buffer';

interface ZlibModule {
  crc32(data: Uint8Array): number;
}

// Loaded the way `png.ts` loads it, for the reason given there: the project ships no
// `@types/node`, and a `declare module 'node:zlib'` is an invalid augmentation.
const ZLIB_MODULE_SPECIFIER: string = 'node:zlib';
const zlib = (await import(ZLIB_MODULE_SPECIFIER)) as ZlibModule;

const META_ACTUAL_SIZE_OFFSET = 28;
const MIN_META_VERSION = 3;
const DATA_REGION_OFFSET = 4;

export interface MmkvStore {
  /** The string stored under `key`, or `undefined` when the key is absent or deleted. */
  getString(key: string): string | undefined;
  keys(): string[];
}

function readVarint(buf: NodeBuffer, offset: number, end: number, what: string): [value: number, next: number] {
  let value = 0;
  let shift = 0;
  let at = offset;
  for (;;) {
    if (at >= end || shift > 28) throw new Error(`${what}: a varint runs past its bounds at byte ${offset}`);
    const byte = buf[at];
    at += 1;
    value += (byte % 128) * 2 ** shift;
    if (byte < 128) return [value, at];
    shift += 7;
  }
}

/** Parses the store's items. `name` only labels errors (for example the file path). */
export function readMmkv(data: NodeBuffer, meta: NodeBuffer, name: string): MmkvStore {
  if (meta.length < META_ACTUAL_SIZE_OFFSET + 4) throw new Error(`${name}: the .crc meta file is ${meta.length} bytes, too short`);
  const crc = meta.readUInt32LE(0);
  const version = meta.readUInt32LE(4);
  if (version < MIN_META_VERSION) {
    throw new Error(`${name}: meta version ${version} keeps its size elsewhere; only version ${MIN_META_VERSION} and later is read`);
  }
  const actualSize = meta.readUInt32LE(META_ACTUAL_SIZE_OFFSET);
  const end = DATA_REGION_OFFSET + actualSize;
  if (end > data.length) throw new Error(`${name}: the meta file says ${actualSize} bytes of data, the file has ${data.length - DATA_REGION_OFFSET}`);
  const region = data.subarray(DATA_REGION_OFFSET, end);
  const computed = zlib.crc32(region);
  if (computed !== crc) {
    throw new Error(`${name}: crc32 of the data is ${computed.toString(16)}, the meta file says ${crc.toString(16)} (pulled mid-write, or not an MMKV store)`);
  }

  const values = new Map<string, NodeBuffer>();
  let [, at] = readVarint(data, DATA_REGION_OFFSET, end, name);
  while (at < end) {
    const [keyLength, afterKeyLength] = readVarint(data, at, end, name);
    const keyEnd = afterKeyLength + keyLength;
    if (keyEnd > end) throw new Error(`${name}: a key runs past the data at byte ${at}`);
    const key = data.toString('utf8', afterKeyLength, keyEnd);
    const [valueLength, afterValueLength] = readVarint(data, keyEnd, end, name);
    const valueEnd = afterValueLength + valueLength;
    if (valueEnd > end) throw new Error(`${name}: the value of "${key}" runs past the data`);
    if (valueLength === 0) values.delete(key);
    else values.set(key, data.subarray(afterValueLength, valueEnd) as NodeBuffer);
    at = valueEnd;
  }

  return {
    getString(key: string): string | undefined {
      const value = values.get(key);
      if (value === undefined) return undefined;
      const [length, start] = readVarint(value, 0, value.length, `${name} "${key}"`);
      if (start + length !== value.length) throw new Error(`${name}: the value of "${key}" is not a string`);
      return value.toString('utf8', start, value.length);
    },
    keys(): string[] {
      return [...values.keys()];
    },
  };
}
