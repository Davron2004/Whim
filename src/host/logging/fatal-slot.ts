/**
 * fatal-slot — the one persisted diagnostic record (developer-observability D5; spec
 * device-diagnostics "Uncaught host errors and fatal JS errors are captured").
 *
 * A fatal JS error ends the process before any flush, so the global handler writes that one
 * record's allowlisted projection under a single fixed key, and the next launch uploads it and
 * deletes it. The ring buffer itself is still never persisted: only this one record, already
 * projected, and only while an upload would have been allowed when the error happened.
 *
 * No React Native import: the store is injected (`whim.launcher` MMKV on the device, a Map in the
 * Node suite).
 */

import type { DiagnosticRecord } from '@whim/contract';
import type { KVBackend } from '../version-store/fs/kv-fs';
import { isDiagnosticRecord } from './diagnostic';
import type { DiagnosticsTransport } from './diagnostics';

const FATAL_SLOT_KEY = 'whim.fatal-error:v1';

/** Keep a fatal error's projection for the next launch, replacing whatever the slot held — but
 *  only while an upload is allowed; a record that could not be sent now is not kept for later.
 *  Never throws: it runs inside the global error handler, which must still reach the handler it
 *  chains to. */
export function keepFatalRecord(kv: KVBackend, transport: Pick<DiagnosticsTransport, 'allowed'>, record: DiagnosticRecord): void {
  try {
    if (transport.allowed()) kv.set(FATAL_SLOT_KEY, JSON.stringify(record));
    // eslint-disable-next-line no-restricted-syntax -- intentional: the process is already dying; a slot that cannot be written loses one report, and throwing here would skip the handler this one chains to.
  } catch {
    // deliberately silent — see the disable comment above
  }
}

/** The kept record, or `undefined` when the slot is empty, unreadable, or holds anything that is
 *  not a projection this device would send. */
export function readFatalRecord(kv: KVBackend): DiagnosticRecord | undefined {
  try {
    const raw = kv.getString(FATAL_SLOT_KEY);
    if (raw == null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return isDiagnosticRecord(parsed) ? parsed : undefined;
    // eslint-disable-next-line no-restricted-syntax -- intentional: a corrupted slot is an empty slot (it is deleted after this read either way), never a launch-time throw.
  } catch {
    return undefined;
  }
}

/**
 * At launch: hand the kept record to the upload and flush it now, then delete the slot. The slot
 * is deleted after the attempt whatever happened — sent, refused, unreachable, or not allowed —
 * so a record is never sent on two launches.
 */
export async function sendFatalRecord(kv: KVBackend, transport: Pick<DiagnosticsTransport, 'enqueueDiagnostic' | 'flush'>): Promise<void> {
  const record = readFatalRecord(kv);
  try {
    if (record) {
      transport.enqueueDiagnostic(record);
      await transport.flush();
    }
  } finally {
    kv.delete(FATAL_SLOT_KEY);
  }
}
