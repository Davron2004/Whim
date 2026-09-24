/**
 * app-info — the installed app's platform, marketing version and build number (request-envelope
 * D2; spec "Every /v1 request carries the client envelope"). The values come from the installed
 * binary through the `WhimAppInfo` native module, never from a constant in the repo: the build
 * number is injected at release time, after the JS is bundled.
 *
 * Pure: no `react-native` import, so Node suites load it directly and inject the constants. The
 * one seam that reads the real native module is `installed-app-info.ts`.
 */

export type AppPlatform = 'ios' | 'android';

export interface AppInfo {
  readonly platform: AppPlatform;
  /** The installed marketing version, e.g. "1.0.0". Never empty. */
  readonly version: string;
  /** The installed build number: a positive safe integer. */
  readonly build: number;
}

/** What the `WhimAppInfo` native module reports: both values as the raw strings the OS holds.
 *  Fields are `unknown` because they cross the native boundary; `appInfoFrom` checks them. */
export interface NativeAppInfoConstants {
  readonly version?: unknown;
  readonly build?: unknown;
  readonly internalBuild?: unknown;
}

const POSITIVE_INTEGER_RE = /^[1-9]\d*$/;

/** The marketing versions the server's envelope accepts: a digit first, then up to 31 of
 *  `[0-9A-Za-z.+-]`. A copy of `@whim/contract`'s `APP_VERSION_PATTERN` (device code imports the
 *  contract type-only); `checks/test/repo/header-lockstep.suite.ts` holds the two equal. */
export const APP_VERSION_PATTERN = /^\d[0-9A-Za-z.+-]{0,31}$/;

function platformOf(os: string): AppPlatform {
  if (os === 'ios' || os === 'android') {
    return os;
  }
  throw new Error(`WhimAppInfo: unsupported platform ${JSON.stringify(os)}`);
}

function versionOf(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') {
    throw new TypeError('WhimAppInfo: version is missing');
  }
  if (!APP_VERSION_PATTERN.test(raw)) {
    throw new Error(`WhimAppInfo: version ${JSON.stringify(raw)} is not a version the server accepts`);
  }
  return raw;
}

function buildOf(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') {
    throw new Error('WhimAppInfo: build is missing');
  }
  const build = typeof raw === 'string' && POSITIVE_INTEGER_RE.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(build)) {
    throw new TypeError(`WhimAppInfo: build ${JSON.stringify(raw)} is not a positive integer`);
  }
  return build;
}

/**
 * Turn `Platform.OS` and the native module's constants into an `AppInfo`, or throw an `Error`
 * whose message starts with "WhimAppInfo: ". Checks run in this order: the platform, a missing
 * module (`constants` null or undefined), the version (must be a non-empty string matching
 * `APP_VERSION_PATTERN`), the build (must be a decimal string of a positive safe integer, no sign,
 * no leading zero, no dots).
 */
export function appInfoFrom(os: string, constants: NativeAppInfoConstants | null | undefined): AppInfo {
  const platform = platformOf(os);
  if (constants === null || constants === undefined) {
    throw new Error('WhimAppInfo: the native module is missing from this build');
  }
  return { platform, version: versionOf(constants.version), build: buildOf(constants.build) };
}

/**
 * Whether the installed binary is an internal build (dev, or the local offline Android build) —
 * the build flag behind legal-surface-v2 design D10: only an internal build shows or honours a
 * server-address override. Anything but the boolean `true` — a missing module, a missing or
 * non-boolean value — reads as a store build, so a build that can't say which it is behaves as
 * the one the privacy policy covers.
 */
export function internalBuildFrom(constants: NativeAppInfoConstants | null | undefined): boolean {
  return constants?.internalBuild === true;
}

/**
 * A reader that calls `readConstants` on its first successful use and returns that same `AppInfo`
 * on every later call: the installed binary can't change while the process lives. A failed read
 * is not cached, so every call until one succeeds reads again and throws again.
 */
export function appInfoReader(
  os: string,
  readConstants: () => NativeAppInfoConstants | null | undefined,
): () => AppInfo {
  let cached: AppInfo | undefined;
  return () => {
    cached ??= appInfoFrom(os, readConstants());
    return cached;
  };
}
