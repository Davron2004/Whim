/**
 * app-busy — the per-app in-flight registry behind the home grid's wait affordances
 * (`app-launcher`: "Opening an app shows an immediate busy affordance" / "Fork and delete show a
 * busy state and cannot be re-triggered mid-operation").
 *
 * One app can have at most ONE operation in flight. That single rule buys both halves of the
 * spec at once: the affordance knows what to render (`opFor`), and a second tap while the first
 * operation is still running is refused rather than starting a duplicate version-store op.
 *
 * The guard has to be synchronous and independent of React's render cycle — two taps inside one
 * frame both read the same `useState` value, so state alone cannot refuse the second. Hence a
 * plain class the shell holds in a ref, with `snapshot()` as the render-visible projection. No
 * React and no I/O here, so the refusal and the clearing are directly Node-testable.
 */

/** The operations a home-grid app can have in flight. Each is a distinct affordance: `open` is
 *  the tile's own pressed/busy look, `fork`/`delete` are their action-sheet rows. */
export type AppBusyOp = 'open' | 'fork' | 'delete';

/** The render-visible projection: app id -> the operation currently running for it. */
export type AppBusyMap = Readonly<Record<string, AppBusyOp>>;

export class AppBusy {
  private readonly slots = new Map<string, AppBusyOp>();

  /**
   * Claim `appId` for `op`. Returns `false` — and changes nothing — when that app already has an
   * operation in flight, which is the caller's signal to do nothing at all: no version-store
   * call, no alert, no state write.
   */
  begin(appId: string, op: AppBusyOp): boolean {
    if (this.slots.has(appId)) return false;
    this.slots.set(appId, op);
    return true;
  }

  /** The operation settled — success or failure alike. Idempotent, so a caller can end from a
   *  `finally` without knowing whether it ever claimed the slot. */
  end(appId: string): void {
    this.slots.delete(appId);
  }

  /** What `appId` is busy with, or `undefined` when it is idle. */
  opFor(appId: string): AppBusyOp | undefined {
    return this.slots.get(appId);
  }

  /** A fresh plain object per call, so passing it into React state always reads as a change. */
  snapshot(): AppBusyMap {
    return Object.fromEntries(this.slots) as AppBusyMap;
  }
}

/**
 * Run one app operation under the registry: claim the slot, publish the affordance, and release
 * it once `work` settles — success, failure or throw alike, so a failed fork or delete can never
 * strand a tile in a permanent busy state.
 *
 * Returns `false` without running `work` at all when that app already has an operation in flight.
 * That refusal is the whole "cannot be re-triggered mid-operation" requirement, and it lives here
 * rather than in the screen so the *version-store call* is what is guarded, not merely the
 * control that triggers it.
 *
 * `publish` is the shell's `setState` mirror; `work` owns its own error surface (the shell's
 * `Alert.alert` paths), and anything it does rethrow still passes through with the slot released.
 */
export async function runAppOp(
  registry: AppBusy,
  publish: (busy: AppBusyMap) => void,
  appId: string,
  op: AppBusyOp,
  work: () => Promise<void>,
): Promise<boolean> {
  if (!registry.begin(appId, op)) return false;
  publish(registry.snapshot());
  try {
    await work();
  } finally {
    registry.end(appId);
    publish(registry.snapshot());
  }
  return true;
}

/**
 * Whether the home grid should render `appId`'s tile busy. ANY in-flight operation counts, not
 * just `open`: fork and delete are triggered from sheets that close before the version-store call
 * starts (`app-launcher`: "Fork and delete each show a busy state on their triggering control
 * while their underlying version-store operation runs"), so after the sheet is gone the tile is
 * the only surviving control for that app and therefore where the wait has to be visible.
 */
export function isAppBusy(busy: AppBusyMap | undefined, appId: string): boolean {
  return busy?.[appId] !== undefined;
}
