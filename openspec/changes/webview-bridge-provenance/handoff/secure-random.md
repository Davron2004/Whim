# Contract: secure-random (chain-7, writes) — the `WhimRandom` TurboModule

Interface only. Design: `design.md` D1. Hermes has no `crypto`; this module is the only
sanctioned source of the per-WebView bridge token's bytes. No JS fallback exists or may be added.

## JS surface

File: `src/native/NativeWhimRandom.ts` (codegen spec; default export is the module or `null`).

```ts
import type { TurboModule } from 'react-native';
export interface Spec extends TurboModule {
  randomHex(byteCount: number): string | null;   // synchronous
}
export default TurboModuleRegistry.get<Spec>('WhimRandom');   // Spec | null
```

Import from a host file as `import NativeWhimRandom from '../../native/NativeWhimRandom'`
(relative path from the importer; the same shape as `NativeWhimHaptics` in `src/host/haptics.ts`).
There is no named wrapper: the importer owns the null handling.

## Getting the module: `get`, not `getEnforcing`

The spec uses `TurboModuleRegistry.get`, so a build without the module yields `null` at import
instead of throwing. The caller MUST treat a `null` module as "no token available" and fail
closed (do not mount the page / do not accept bridge posts); never substitute `Math.random`.

## Semantics of `randomHex(byteCount)`

- Returns exactly `2 * byteCount` lowercase hex characters (`/^[0-9a-f]+$/`), `byteCount` bytes
  from Android `java.security.SecureRandom` / iOS `SecRandomCopyBytes(kSecRandomDefault)`.
- Returns `null` when `byteCount` is not an integer in 1–64 (0, 65, 1.5, NaN, negatives all
  `null`), or when the OS random call fails (iOS: any status but `errSecSuccess`).
- Never throws across the bridge. Calls are independent; there is no state.
- A 128-bit token is `randomHex(16)` (32 hex chars). A caller seeing `null` from a valid
  `randomHex(16)` has hit an OS failure: fail closed.

## Native names (must stay in lockstep; `checks/test/release/secure-random.suite.ts` pins them)

- Module name string: `WhimRandom` (JS spec, Kotlin `WhimRandomModule.NAME`, iOS `+moduleName`).
- `package.json` `codegenConfig.ios.modulesProvider`: `"WhimRandom": "WhimRandomModule"`.
- Android: `com.whim.random.WhimRandomModule` / `WhimRandomPackage`, added in `MainApplication`;
  generated spec class `com.whim.tone.NativeWhimRandomSpec`.
- iOS: `ios/Whim/WhimRandomModule.mm`, in the Whim target's Sources phase.

## Stubbing it in the Node suites (chain-3)

`src/host/launcher/test/native-host.tsx` owns the RN mock; its `turboModules` map (read by
`TurboModuleRegistry.get`) is where the module is registered. Register under the exact name
`WhimRandom` an object with one method `randomHex(byteCount)`:

- Default mode: a deterministic, spec-faithful stub — validate `byteCount` as above (return
  `null` outside integer 1–64) and otherwise return `byteCount` bytes as lowercase hex (e.g. a
  counter-seeded sequence, so two successive calls differ and tests can predict them).
- Failing mode: a switch on the exported host state (like `keyboardShows.handler`) making
  `randomHex` return `null` for every call, and a way to leave the name out of `turboModules` so
  `get('WhimRandom')` resolves `null` (the module-missing case). Tests for both must assert the
  host fails closed (no token minted, page not mounted) rather than falling back.
- A test must not stub `randomHex` to return a non-hex or wrong-length string and expect the
  host to cope: that violates this contract; the host may reject it.

## Compilation status

Authored by mirroring `WhimHaptics`; `checks:test --only release` (static) passes. The Kotlin and
Objective-C++ sources are NOT compiled by chain-7's author: the runner's task 8.3 (Gradle
`:app:compileReleaseKotlin`, Xcode build) is the compile proof.
