/**
 * highlighting — the Whim Syntax prose-highlighting on/off toggle (orchestrator decision
 * "Highlighting off-switch is a launcher setting"; docs/design/README.md discipline rule 5,
 * "it must survive being switched off").
 *
 * Persisted the same way every other launcher setting persists: a tolerant load/save pair over
 * the SAME `whim.launcher` KVBackend the theme (`theme.ts`, pre-v2), server address
 * (`server-address.ts`), and device id (`device-id.ts`) already use. Stores ONLY the boolean —
 * the Whim Syntax renderer (a separate change, `src/host/ui/whim-prose/`) reads it to decide
 * whether to render marked-up or flat prose. Default ON.
 */

import type { KVBackend } from '../version-store/fs/kv-fs';

const HIGHLIGHTING_KEY = 'highlighting';

/** Read the persisted highlighting flag. Tolerant: an absent key or any stored value other than
 *  the literal `'0'` resolves to the default (ON) — never throws. */
export function loadHighlighting(kv: KVBackend): boolean {
  return kv.getString(HIGHLIGHTING_KEY) !== '0';
}

/** Persist the highlighting flag as `'1'`/`'0'`. */
export function saveHighlighting(kv: KVBackend, enabled: boolean): void {
  kv.set(HIGHLIGHTING_KEY, enabled ? '1' : '0');
}
