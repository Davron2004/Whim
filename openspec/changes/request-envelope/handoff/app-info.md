# app-info (chain-3 → chain-4, chain-5)

The installed app's platform, marketing version and build number, read from the installed binary
through the `WhimAppInfo` TurboModule (design D2). Two files: a pure wrapper Node suites import,
and the one RN seam everything on the device calls.

## Device code: the seam

`src/host/launcher/installed-app-info.ts` (imports `react-native`; never import it from a pure
module that a non-launcher Node suite loads)

```ts
export const installedAppInfo: () => AppInfo;
```

- **When it reads:** lazily, on the first call. It reads `Platform.OS` and the native constants
  once, validates them, caches the `AppInfo`, and returns that same object on every later call.
  Nothing is read at import time, so importing the seam never throws.
- **Failure:** throws whatever `appInfoFrom` throws (below). A failed read is not cached: every
  call until one succeeds reads again and throws again. Callers decide what a throw means (it is
  a broken build, not a user condition).

## Pure wrapper

`src/host/launcher/app-info.ts` (no `react-native` import)

```ts
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
}

export function appInfoFrom(os: string, constants: NativeAppInfoConstants | null | undefined): AppInfo;

export function appInfoReader(
  os: string,
  readConstants: () => NativeAppInfoConstants | null | undefined,
): () => AppInfo;
```

- `appInfoFrom` validates and converts; it never caches.
- `appInfoReader` returns a function with the seam's exact caching and failure behaviour;
  `installedAppInfo` is `appInfoReader(Platform.OS, () => NativeWhimAppInfo?.getConstants())`.

## Failure surface (exact)

Every failure is a plain `Error`, thrown synchronously by `appInfoFrom` (so by the seam's call,
never at import). Checks run in this order; the first failing one throws:

| Condition | `message` |
|---|---|
| `os` is not `'ios'` or `'android'` | `WhimAppInfo: unsupported platform "<os>"` (os JSON-quoted) |
| `constants` is `null`/`undefined` (module not in this build) | `WhimAppInfo: the native module is missing from this build` |
| `version` is not a string, or is `""` | `WhimAppInfo: version is missing` |
| `version` doesn't match `APP_VERSION_PATTERN` (`^\d[0-9A-Za-z.+-]{0,31}$`, the contract's; lockstep-checked) | `WhimAppInfo: version "<v>" is not a version the server accepts` |
| `build` is `undefined`, `null` or `""` | `WhimAppInfo: build is missing` |
| `build` is anything else that is not a decimal string of a positive safe integer (no sign, no leading zero, no whitespace, no dots/exponent; a number is refused too) | `WhimAppInfo: build <JSON.stringify(build)> is not a positive integer` |

Examples: `"1.2.3"`, `"0"`, `"007"`, `" 42"`, `"1e3"`, `42` all throw the last row; `"380642"`
returns `build: 380642`.

## Native module (for reference; callers never touch it)

- Spec `src/native/NativeWhimAppInfo.ts`: `getConstants(): { version: string; build: string }`,
  obtained with `TurboModuleRegistry.get<Spec>('WhimAppInfo')` (null when absent, never throws).
- Android `WhimAppInfoModule.kt` (`com.whim.tone`, registered in `WhimTonePackage`):
  `PackageInfo.versionName` (null → `""`) and `longVersionCode.toString()`.
- iOS `ios/Whim/WhimAppInfoModule.mm`: `CFBundleShortVersionString` and `CFBundleVersion`
  (missing/non-string → `""`), registered with `RCT_EXPORT_MODULE(WhimAppInfo)`.

## Injecting constants in a Node suite

Import the pure module and pass the platform and constants directly:

```ts
import { appInfoFrom, appInfoReader } from '../app-info';
appInfoFrom('android', { version: '1.0.0', build: '380642' }); // { platform: 'android', version: '1.0.0', build: 380642 }
const read = appInfoReader('ios', () => ({ version: '1.0.0', build: '7' }));
```

A module that calls `installedAppInfo` should take the `AppInfo` (or a `() => AppInfo`) as an
injected argument so its suite can supply one; don't import the seam from a pure module. Under
the launcher runner (`src/host/launcher/test/run.mjs`) `react-native` is aliased to
`test/native-host.tsx`: `Platform.OS` is `'ios'` and `TurboModuleRegistry.get` returns `null`, so
calling the real seam there throws the "native module is missing" error.
