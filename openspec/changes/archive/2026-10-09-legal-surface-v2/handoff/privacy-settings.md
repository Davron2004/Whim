# handoff/privacy-settings.md — chain-5; read by developer-observability chain-4 (and chain-6)

## Error-details preference — `src/host/launcher/error-details.ts` (non-RN)

```ts
import type { KVBackend } from '../version-store/fs/kv-fs';
export function errorDetailsEnabled(kv: KVBackend): boolean;      // never throws
export function setErrorDetails(kv: KVBackend, on: boolean): void;
```
- Key `whim.error-details:v1` (module-private) in the `whim.launcher` KV (the one `createMmkvBackend('whim.launcher')`
  instance `LauncherRoot` owns). Stored as `'1'` / `'0'`.
- Default ON: only the literal `'0'` reads as off. A missing key, any other value, or a `getString` that throws → `true`.
- Not cached: every call reads the KV. A diagnostics transport SHALL call `errorDetailsEnabled(kv)` at each upload
  decision (not once at startup), so a switch flipped in Settings applies to the very next decision.
- Writer: only Settings' "Send error details" switch (`LauncherRoot#onErrorDetailsChange` → `setErrorDetails`).
  A transport reads, never writes.
- Consent is separate: this preference does not grant or require AI-data consent, and revoking consent does not
  change it. A transport that also needs consent reads `consentStatus(kv)` itself.

## Phone ID — `src/host/launcher/device-id.ts` (non-RN)

```ts
export function getDeviceId(kv: KVBackend): string;    // unchanged: reads, or generates + persists on first use
export function resetDeviceId(kv: KVBackend): string;  // new: writes a fresh random UUID-v4-shaped id, returns it
```
- Key `whim.device:v1` (module-private), same `whim.launcher` KV. The value is what every request sends as
  `x-whim-device`.
- `resetDeviceId` touches only that key: the consent grant, the terms acceptance and installed apps are unchanged.
- In `LauncherRoot`, `deviceId` is React state (`useState(() => getDeviceId(kv))`), replaced by
  `setDeviceId(resetDeviceId(kv))` after Settings' confirm step. Every options memo (`clientOptions`,
  `reportOptions`) is keyed on it. Code outside `LauncherShell` that needs the ID SHALL read `getDeviceId(kv)` at
  send time, never cache it past a request, so it follows a reset.

## Internal vs store build — `src/host/launcher/app-info.ts`, `installed-app-info.ts`

```ts
// app-info.ts (pure)
export interface NativeAppInfoConstants { readonly version?: unknown; readonly build?: unknown; readonly internalBuild?: unknown }
export function internalBuildFrom(constants: NativeAppInfoConstants | null | undefined): boolean; // only `true` → true
// installed-app-info.ts (RN seam)
export function installedInternalBuild(): boolean;   // reads the WhimAppInfo TurboModule's constants
```
Native source: `WhimAppInfo.getConstants().internalBuild` (`src/native/NativeWhimAppInfo.ts`).

| Build path | Command | Flag | `internalBuild` |
|---|---|---|---|
| Android debug | `npm run android` (Metro) | Gradle `buildConfigField WHIM_INTERNAL_BUILD true` (`debug`) | true |
| Android offline | `npm run android:release` | `WHIM_INTERNAL_BUILD true` (`offline`, overrides `initWith release`) | true |
| Android store | fastlane `gradle task: bundle, build_type: Release` | `WHIM_INTERNAL_BUILD false` (`release`) | false |
| iOS Debug | `react-native run-ios` (Debug config) | `#if DEBUG` (`DEBUG=1`) in `WhimAppInfoModule.mm` | true |
| iOS store | fastlane `build_app configuration: "Release"` | no `DEBUG` | false |
| Node suites | — | module absent → fail-safe | false (suites pass `internalBuild` explicitly) |

## Server-address override — `src/host/launcher/server-address.ts` (signatures changed)

```ts
export function serverOverride(kv: KVBackend, internalBuild: boolean): string | undefined; // undefined in a store build
export function effectiveServerUrl(kv: KVBackend, internalBuild: boolean): string;         // override ?? RELEASE.serverUrl
// consent-options.ts
export function liveClientOptions(kv: KVBackend, deviceId: string, appInfo: () => AppInfo, internalBuild: boolean): ConsentedClientOptions | null;
```
- `loadServerUrl` / `saveServerUrl` / `clearServerUrl` are unchanged. A store build never deletes a saved override;
  it just never reads it.
- Any new sender (a diagnostics transport included) SHALL resolve its base URL through `effectiveServerUrl(kv,
  internalBuild)`, never `loadServerUrl`, so a store build always targets the server the privacy policy covers.
- `LauncherRoot` props: `{ appInfo?: () => AppInfo; internalBuild?: boolean }`, both defaulting to the native seam.
  `test/rendered-launcher.tsx` `LauncherSetup.internalBuild?: boolean` defaults to `true`; `SentRequest.url` holds
  the full request URL.

## Settings surface (`SettingsScreen.tsx` props added)

`internalBuild: boolean` (false → no Advanced section, no address field), `errorDetails: boolean`,
`onErrorDetailsChange(on)`, `deviceId: string` (rendered as the one `selectable` text), `onResetDeviceId()`
(called only from the confirm dialog's "Make a new ID"; Cancel does nothing).
Copy keys (English-only `COPY`, not `LegalCopyKey`): `settingsErrorDetailsTitle`, `settingsErrorDetailsHint`,
`settingsDeviceIdTitle`, `settingsDeviceIdHint`, `settingsDeviceIdReset`, `settingsDeviceIdResetConfirm`.

## Legal flow addition (`consent-flow.ts`)

`ConsentContinuation` gains `| { kind: 'settings' }`: review-mode "Turn on AI features" when `nextLegalStep(...)`
isn't `'consent'` enters the flow with `{ continuation: { kind: 'settings' }, returnTo: { kind: 'settings' } }`
(terms step, then ask-mode consent, then Settings). When consent is the only missing step it still grants directly.
