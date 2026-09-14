/**
 * Release build numbers (design D3; specs/store-release-pipeline/spec.md "Each lane uses one
 * time-derived build number"). `buildNumberAt(date)` is the whole minutes elapsed since
 * 2026-01-01T00:00Z, so one lane run can hand the same number to both platforms with no shared
 * state or credentials.
 */

/** 2026-01-01T00:00:00.000Z, in epoch milliseconds. */
export const BUILD_NUMBER_EPOCH_UTC = Date.UTC(2026, 0, 1, 0, 0, 0, 0);

/** `floor((date − BUILD_NUMBER_EPOCH_UTC) / 60s)`. Throws for any `date` before the epoch. */
export function buildNumberAt(date: Date): number {
  const elapsedMs = date.getTime() - BUILD_NUMBER_EPOCH_UTC;
  if (elapsedMs < 0) {
    throw new Error(
      `buildNumberAt: ${date.toISOString()} is before the epoch ${new Date(BUILD_NUMBER_EPOCH_UTC).toISOString()}`,
    );
  }
  return Math.floor(elapsedMs / 60_000);
}

/** Throws, naming both numbers, unless `build` is strictly greater than `storeLatest`. */
export function assertBuildNumberAbove(build: number, storeLatest: number): void {
  if (build <= storeLatest) {
    throw new Error(`build number ${build} is not above the store's latest build number ${storeLatest}`);
  }
}
