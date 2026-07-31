/**
 * device-id — the persisted anonymous device identity (prompt-flow-ux D2; spec "Every server
 * request carries a persisted anonymous device identity").
 *
 * Generated once, stored under `whim.device:v1` in the SAME `whim.launcher` KVBackend the
 * installed-apps index and theme pref already use (LauncherRoot's one shared instance), and
 * attached as the `x-whim-device` header on every rewrite/generation request via
 * `ClientOptions.deviceId` (generation-client.ts).
 *
 * This id is anonymous metering, not a security boundary — `crypto.randomUUID` is preferred
 * when available, but a non-cryptographic UUID-v4-*shaped* fallback (`Math.random`) is
 * acceptable and avoids adding a new native dependency (`react-native-get-random-values`/`uuid`)
 * for a one-line generator.
 */

import type { KVBackend } from '../version-store/fs/kv-fs';

const DEVICE_ID_KEY = 'whim.device:v1';

function randomUuidV4Shaped(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof cryptoObj?.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  // Non-cryptographic fallback: fills a UUID-v4 template (version nibble 4, variant nibble
  // 8/9/a/b) with Math.random-derived hex digits. Anonymous metering only, not a security
  // boundary (design D2) — crypto.randomUUID above is preferred whenever it exists.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    // eslint-disable-next-line no-bitwise, sonarjs/pseudo-random
    const r = (Math.random() * 16) | 0;
    // eslint-disable-next-line no-bitwise
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Read the persisted device id from `kv`, generating and persisting one on first use.
 * Subsequent calls (even across process restarts, since `kv` is backed by durable storage
 * on device) return the SAME id.
 */
export function getDeviceId(kv: KVBackend): string {
  const existing = kv.getString(DEVICE_ID_KEY);
  if (existing) {
    return existing;
  }
  const id = randomUuidV4Shaped();
  kv.set(DEVICE_ID_KEY, id);
  return id;
}
