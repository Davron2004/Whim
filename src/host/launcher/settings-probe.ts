/** The Settings server address's two debounces: the save (`DebouncedSave`) and the verification
 * probe (`DebouncedProbe`), each settling once typing pauses. Each edit invalidates any older probe
 * result; cancel() fences pending work on unmount. */

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
 * The address save, settled once per pause instead of once per keystroke: every save points the
 * app's connectivity probe at the new address, so saving each keystroke probed every half-typed
 * address. `edit` holds the latest draft and saves it `debounceMs` after the last edit; `flush` saves
 * a held draft now (submit, blur, leaving the screen); `cancel` drops it unsaved.
 */
export class DebouncedSave {
  private held: { value: string } | null = null;
  private pendingTimer: unknown = null;
  private readonly timers: TimerLike;
  private readonly debounceMs: number;
  constructor(private readonly opts: { save: (value: string) => void; debounceMs?: number; timers?: TimerLike }) {
    this.timers = opts.timers ?? REAL_TIMERS;
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  edit(value: string): void {
    this.cancelTimer();
    this.held = { value };
    this.pendingTimer = this.timers.setTimeout(() => this.flush(), this.debounceMs);
  }

  flush(): void {
    this.cancelTimer();
    const held = this.held;
    this.held = null;
    if (held) this.opts.save(held.value);
  }

  cancel(): void {
    this.cancelTimer();
    this.held = null;
  }

  private cancelTimer(): void {
    if (this.pendingTimer != null) this.timers.clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
  }
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
  private pendingUrl = '';
  private readonly timers: TimerLike;
  private readonly debounceMs: number;
  constructor(private readonly opts: DebouncedProbeOptions) {
    this.timers = opts.timers ?? REAL_TIMERS;
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  schedule(url: string): void {
    this.clearPendingTimer();
    this.generation += 1;
    if (url.trim().length === 0) {
      this.setState('idle');
      return;
    }
    this.pendingUrl = url;
    this.pendingTimer = this.timers.setTimeout(() => this.flush(), this.debounceMs);
  }

  /** Runs a scheduled probe now rather than at the end of its debounce (submit, blur). */
  flush(): void {
    if (this.pendingTimer == null) return;
    this.clearPendingTimer();
    this.runProbe(this.pendingUrl, this.generation);
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
