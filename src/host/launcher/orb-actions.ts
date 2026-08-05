/**
 * orb-actions — the orb's tapped-menu action set, plus its per-action tap-count instrumentation
 * (shell-redesign-v2 chain-G, `app-launcher` §"The orb is a tapped menu whose actions are
 * instrumented"; design D12).
 *
 * The action set carries only cheap, undoable actions: delete, rename and restore are
 * deliberately absent — anything that cannot be undone with one tap belongs on a screen where it
 * can be read, not a menu row. Order matches the design-extract's cardinal ordering (up/right/
 * down = change/home/versions), preserved here as metadata only — no wheel geometry is built in
 * this change. `copy` (the fourth cardinal action) is deliberately absent too (review fix-pass,
 * shell-redesign-v2): there is no designed fork-from-orb sheet yet, and an under-filled menu beats
 * a fake one. History's own "Start a copy here" row action (chain-E) covers forking a version
 * until this gets a real design.
 *
 * Instrumentation persists through the SAME `whim.launcher` KVBackend every other launcher
 * setting uses (theme pref, highlighting flag, server address, device id — see
 * `highlighting.ts`), so the wheel's eventual default action set can later be chosen from use
 * rather than opinion. No counter, count, or instrumentation value is ever shown on the
 * user-facing surface.
 */

import type { KVBackend } from '../version-store/fs/kv-fs';
import { SHELL_COLORS } from '../../sdk/theme';
import { COPY } from './copy';

export type OrbActionId = 'change' | 'home' | 'versions';

export interface OrbAction {
  id: OrbActionId;
  label: string;
}

/** The fixed, cheap-and-undoable action set. Nothing here fires a destructive operation. */
export const ORB_ACTIONS: readonly OrbAction[] = [
  { id: 'change', label: COPY.orbActionChangeIt },
  { id: 'home', label: COPY.orbActionHome },
  { id: 'versions', label: COPY.orbActionVersions },
];

// ── the per-row swatch (design `3a`/`3b`/`3c`, html:220-224) ─────────────────
// Each menu row carries a 30×30 tinted swatch left of its label. These three lookups live beside
// the action set — the orb's own private data module, never `src/sdk/design-tokens.ts` — because
// one consumer does not justify a shared `SHELL_COLORS`/`RADIUS` role (fix-design-conformance
// R15). They sit here rather than inside `Orb.tsx` only because that file imports `react-native`
// and so can never be loaded by the Node acceptance suite; the scoping is unchanged.

/** Per-action swatch fill. No token has this role yet (R15) — literal until a second surface asks. */
export const ORB_ROW_TINT: Record<OrbActionId, string> = {
  change: '#e6e4f7',
  home: '#e5e2db',
  versions: '#e5e2db',
};

/** Per-action swatch glyph. `⌂` (U+2302) is pending Android glyph-coverage verification on the
 *  on-device screenshot pass — do not substitute a replacement before that check runs. */
export const ORB_ROW_GLYPH: Record<OrbActionId, string> = {
  change: '✎',
  home: '⌂',
  versions: '↺',
};

/** Swatch glyph colour. The design's `m.glyphColor` (`i === 0 ? '#3f3d8f' : '#1c1917'`) is exactly
 *  the accent and text tokens, so this resolves through them rather than repeating the hexes. */
export function orbRowGlyphColor(id: OrbActionId): string {
  return id === 'change' ? SHELL_COLORS.accent : SHELL_COLORS.text;
}

const COUNT_KEY_PREFIX = 'orb-action-count:';

/** Bump the persisted tap count for one action by one. Tolerant of a missing or unreadable prior
 *  value (treated as zero) — never throws. */
export function recordOrbAction(kv: KVBackend, action: OrbActionId): void {
  const key = COUNT_KEY_PREFIX + action;
  const prior = Number(kv.getString(key));
  const next = (Number.isFinite(prior) ? prior : 0) + 1;
  kv.set(key, String(next));
}

/** Read every action's persisted tap count (default 0 when never fired). Instrumentation-only —
 *  nothing on the user-facing surface calls this. */
export function loadOrbActionCounts(kv: KVBackend): Record<OrbActionId, number> {
  const counts = {} as Record<OrbActionId, number>;
  for (const { id } of ORB_ACTIONS) {
    const raw = Number(kv.getString(COUNT_KEY_PREFIX + id));
    counts[id] = Number.isFinite(raw) ? raw : 0;
  }
  return counts;
}
