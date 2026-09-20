/**
 * link-routing — RN-free (design D15; spec app-links). Two independent pieces: which screen an
 * app link should open (`resolveAppLink`), and which safe exit the CURRENTLY showing screen takes
 * before it does (`linkExitFor`, spec "An arriving link leaves the current screen through that
 * screen's own safe exit"). `PendingLinkHolder` keeps the most recent link that arrived before the
 * launcher was ready, releasing only the last (spec "A link that arrives before the launcher is
 * ready waits").
 *
 * No React Native import — this module must load under the Node acceptance suite.
 */

import type { InstalledApp } from './app-index';
import type { PendingBuildRecord } from './pending-builds';

export type LinkResolution =
  | { kind: 'open'; app: InstalledApp }
  | { kind: 'building'; record: PendingBuildRecord }
  | { kind: 'failed'; record: PendingBuildRecord }
  | { kind: 'missing' };

/** `id` has already been parsed from the incoming URL by `parseAppLink` (`app-link.ts`). Installed
 *  apps are checked first: an id can only ever match one of `apps`/`pending` at a time (a launcher
 *  id is never reused across an installed app and a pending record it isn't the attempt for). */
export function resolveAppLink(
  id: string,
  apps: readonly InstalledApp[],
  pending: readonly PendingBuildRecord[],
): LinkResolution {
  const app = apps.find((a) => a.id === id);
  if (app) return { kind: 'open', app };
  const record = pending.find((r) => r.id === id);
  if (!record) return { kind: 'missing' };
  return record.state === 'building' ? { kind: 'building', record } : { kind: 'failed', record };
}

/** The safe exit an arriving link takes on its way in (design D15). `'exit-app'` tears the running
 *  realm down, `'leave-build'` is exactly `Leave it running`, `'leave-failure'` is the failure
 *  screen's own non-destructive Back, `'decline-consent'` is the consent screen's `Not now`, and
 *  `'close-overlay'` closes an open sheet without acting — never forwarded into anything, never
 *  counted toward anything, the same unconditional-precedence idiom `back-policy.ts`'s
 *  `overlayOpen` already keeps for hardware back. Every other kind (home, dev, settings, history,
 *  done, and every step of the compose/clarify/plan flow) already goes Home under its own existing
 *  cancellation rule, so `'home'` is both their exit and the default. */
export type LinkExit = 'exit-app' | 'leave-build' | 'leave-failure' | 'decline-consent' | 'close-overlay' | 'home';

/** `screen` ranges over every `Screen` union member's `kind`, plus the sentinel `'sheet'` standing
 *  in for "a host-level sheet is open right now" — checked FIRST and unconditionally, the same
 *  precedence `back-policy.ts`'s `overlayOpen` keeps over the screen it covers. */
export function linkExitFor(screen: string): LinkExit {
  if (screen === 'sheet') return 'close-overlay';
  switch (screen) {
    case 'app':
      return 'exit-app';
    case 'build':
      return 'leave-build';
    case 'failure':
      return 'leave-failure';
    case 'consent':
      return 'decline-consent';
    default:
      return 'home';
  }
}

/** Holds the most recent link id that arrived before the launcher finished first-run/load,
 *  discarding every earlier one (spec "When several links arrive before then, only the last SHALL
 *  be resolved"). `release()` is a one-shot read: it returns the held id, or `null` if none
 *  arrived, and clears it either way. */
export class PendingLinkHolder {
  private heldId: string | null = null;

  hold(id: string): void {
    this.heldId = id;
  }

  release(): string | null {
    const id = this.heldId;
    this.heldId = null;
    return id;
  }
}
