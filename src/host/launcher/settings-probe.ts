/**
 * settings-probe — Settings screen's debounced save-time verification (design.md decision 3;
 * spec "Saving a server address in Settings immediately probes it and shows the result inline").
 *
 * `SettingsScreen.tsx` imports react-native and cannot be imported under the launcher's Node
 * suite, so the debounce/cancellation state machine lives here rather than inline in the
 * component's `onChangeText` handler — mirrors this repo's pure-logic-in-non-RN-siblings
 * convention (`connectivity.ts`, `server-probe.ts`).
 *
 * The save itself (`onServerUrlChange`, unconditional and immediate) is untouched by this module
 * — `SettingsScreen` calls it directly, in parallel with `schedule()` here. This module owns only
 * the informational probe result; it never gates or delays the save.
 */

import type { ProbeResult } from './server-probe';
import type { TimerLike } from './connectivity';

export type SettingsProbeState = 'idle' | 'checking' | ProbeResult;

const DEFAULT_DEBOUNCE_MS = 600;

const REAL_TIMERS: TimerLike = {
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]),
};

export interface DebouncedProbeOptions {
  /** One probe attempt against the (already-sanitized) drafted address. Never rejects
   *  (`server-probe.ts`'s `probeServer` contract) — this module trusts that and installs no
   *  rejection handler. */
  probe: (url: string) => Promise<ProbeResult>;
  /** Published on every state transition — the screen's `setState` mirror. */
  publish: (state: SettingsProbeState) => void;
  /** Debounce window after the last edit, before the probe fires. Default 600ms (design.md
   *  decision 3). */
  debounceMs?: number;
  /** Defaults to the real global timers. */
  timers?: TimerLike;
}

/**
 * One screen's debounced probe. `schedule(url)` is meant to be called on every edit: it cancels
 * any pending debounce timer AND fences off (by generation count) any probe already in flight
 * from an earlier call, so a stale result can never land and overwrite a newer edit's outcome
 * (design.md decision 3, "cancelling any in-flight probe when a new edit arrives"). An empty/
 * blank `url` resets straight to `'idle'` with nothing scheduled — the field was cleared, there
 * is nothing to probe. `cancel()` is unmount cleanup: it stops any pending timer and fences off
 * any in-flight probe without publishing anything further.
 */
export class DebouncedProbe {
  private state: SettingsProbeState = 'idle';
  private generation = 0;
  private pendingTimer: unknown = null;
  private readonly timers: TimerLike;
  private readonly debounceMs: number;
  /** The most recently started probe's settlement — exposed via `whenIdle()` so a suite driving
   *  a fake clock can await one full cycle (debounce + probe) deterministically, the same seam
   *  `connectivity.ts`'s `ConnectivityLoop` uses. Real callers (the screen) never need this. */
  private inFlight: Promise<void> = Promise.resolve();

  constructor(private readonly opts: DebouncedProbeOptions) {
    this.timers = opts.timers ?? REAL_TIMERS;
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  schedule(url: string): void {
    this.clearPendingTimer();
    this.generation += 1;
    const gen = this.generation;
    if (url.trim().length === 0) {
      this.setState('idle');
      this.inFlight = Promise.resolve();
      return;
    }
    this.pendingTimer = this.timers.setTimeout(() => {
      this.pendingTimer = null;
      this.inFlight = this.runProbe(url, gen);
    }, this.debounceMs);
  }

  /** Resolves once this instance's most recently scheduled probe — debounce timer included — has
   *  settled. */
  async whenIdle(): Promise<void> {
    await this.inFlight;
  }

  /** Unmount cleanup: cancels any pending debounce timer and fences off any in-flight probe. */
  cancel(): void {
    this.clearPendingTimer();
    this.generation += 1;
  }

  private async runProbe(url: string, gen: number): Promise<void> {
    this.setState('checking');
    const result = await this.opts.probe(url);
    if (gen !== this.generation) return; // superseded by a newer edit — discard
    this.setState(result);
  }

  private clearPendingTimer(): void {
    if (this.pendingTimer != null) {
      this.timers.clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  private setState(next: SettingsProbeState): void {
    if (this.state === next) return;
    this.state = next;
    this.opts.publish(next);
  }
}
