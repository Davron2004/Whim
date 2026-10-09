/** Advanced's server address save, settling once typing pauses (`DebouncedSave`). The field sends
 * nothing itself: the save points the session's connectivity probe at the new address, and that one
 * probe is the check the field shows (#130). */

import type { TimerLike } from './connectivity';

const DEFAULT_DEBOUNCE_MS = 600;

const REAL_TIMERS: TimerLike = {
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]),
};

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
