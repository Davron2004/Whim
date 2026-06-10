/**
 * MMKV adapter for KvBackedFs (device-only). MMKV's instance API (getString/set/
 * delete/getAllKeys) already matches our KVBackend, so the instance is returned
 * directly. `react-native-mmkv` is required lazily so this file is never pulled into
 * the Node test bundle or the pure-JS core graph — only the on-device acceptance
 * harness imports it.
 */

import type { KVBackend } from './kv-fs';

interface MmkvInstance {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
  getAllKeys(): string[];
}

export function createMmkvBackend(id = 'whim-version-store'): KVBackend {
  // react-native-mmkv is a real dependency (the chosen persistent backend, D4 / 5.1),
  // so a literal require lets Metro bundle its JS and autolinking ships the native lib.
  // v4 exposes a createMMKV() factory (not `new MMKV()`) and `remove()` (not `delete()`).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createMMKV } = require('react-native-mmkv') as { createMMKV: (cfg: { id: string }) => MmkvInstance };
  const mmkv = createMMKV({ id });
  return {
    getString: key => mmkv.getString(key),
    set: (key, value) => mmkv.set(key, value),
    delete: key => mmkv.remove(key),
    getAllKeys: () => mmkv.getAllKeys(),
  };
}
