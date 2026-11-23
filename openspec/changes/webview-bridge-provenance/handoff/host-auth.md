# Contract: host-auth (chain-3, writes → chain-6 telemetry, group 5 device runs)

Interface only. Source: `src/host/launcher/runtime-message-auth.ts` (pure), `runtime-channel.ts` (RN glue).

## 1. Token: one per WebView instance, minted at its first load end, re-delivered unchanged

- One `RuntimeChannel` per runtime-page WebView instance, for its whole life: pool slots (`MiniAppStage`,
  `channels` by slot key, created at ref attach, deleted at unmount; a recreated slot has a new key),
  `DevProbeScreen` (one, `useState`), `NetworkDenyProbeScreen` (one per keyed variant, in its `RunState`).
- `onLoadStart` is wired to nothing (spurious on iOS and Android; design D1). Canary and exposure: per instance.
- `onLoadEnd` → `channel.deliver(inject)`: mints `mintRuntimeToken(NativeWhimRandom)` at the first call; every
  call injects `authControlJs(token)` = `window.__whimControl&&window.__whimControl.auth('<32 hex>');true;`
  (the SAME token every time) into the main frame, BEFORE the launch's delivery / the waiting page's
  `WARM_PROBE_JS`. Returns `false` (injects nothing) without a token. The page keeps the first token.
- `useMiniAppHost.deliverBySource` refuses unless `channel.current.authorized` (token delivered to this
  instance): logs `error` `whim:page` `'mini-app failed'` `{where:'launch', errorClass:'NoBridgeToken'}` and
  sets `crash: {where:'webview-gone', errorClass:'NoBridgeToken', hostFault:true}` (crash screen at once, no ask-fix).
- No secure source (module missing, `randomHex` null/throws/malformed): token `null`, no `auth`, every
  message dropped and counted, `error` `whim` `'no secure random source: the WebView gets no bridge token'`
  `{where:'bridge-token', errorClass:'NoSecureRandom', surface}` once per WebView (minting is tried once). No fallback.

## 2. Verifier (pure)

```ts
export const RUNTIME_TOKEN_BYTES = 16;
export interface SecureRandomSource { randomHex(byteCount: number): string | null }
export function mintRuntimeToken(source: SecureRandomSource | null | undefined): string | null;
export function authControlJs(token: string): string;            // throws unless /^[0-9a-f]{32}$/
export type DropReason = 'no-token' | 'unsigned' | 'wrong-token';
export type RuntimeMessageVerdict = { ok: true; body: string } | { ok: false; reason: DropReason };
export function acceptRuntimeMessage(raw: unknown, token: string | null): RuntimeMessageVerdict;
export const EXPOSURE_CANARY = 'WHIM-EXPOSURE-CANARY-1';
export function isExposureCanary(raw: unknown): boolean;          // raw === EXPOSURE_CANARY
```

`acceptRuntimeMessage`: constant-time compare of the fixed 36-char prefix `W1.<token>.`; body = rest, unparsed.

## 3. Channel (the head of every consumer)

```ts
export interface RuntimeChannelSnapshot {
  readonly dropped: number;              // per WebView, whole life; canary included
  readonly authorized: boolean;          // the instance's token was delivered
  readonly canary: boolean;              // canary seen from this WebView
  readonly exposure: ExposureRecord | null; // the WebView's latest record; null until its report
}
export interface RuntimeChannelHooks { noToken?: () => void; exposure?: (record: ExposureRecord) => void }
export class RuntimeChannel {
  constructor(source: SecureRandomSource | null | undefined, hooks?: RuntimeChannelHooks);
  deliver(inject: (js: string) => void): boolean;
  get authorized(): boolean;
  receive(raw: unknown): string | null;  // verified body for the consumer, or null (dropped / consumed)
  snapshot(): RuntimeChannelSnapshot;
  subscribe(listener: () => void): () => void;
}
```

`receive` order: canary (exact) → record + drop; else verify → drop + count; else a signed body starting
`{"kind":"bridge-exposure","payload":` with only those two keys is consumed (record, hook); else it is returned.
Consumers: `useMiniAppHost.onMessage` (bound pool slot via `opts.channel` getter, DevProbe), `MiniAppStage`
`onSlotMessage` for every non-bound slot (then only `body === WARM_ANSWER` acts), `NetworkDenyProbeScreen.handleMessage`.
`WARM_PROBE_JS = 'window.__whimControl&&window.__whimControl.warm();true;'`; `WARM_ANSWER` is the verified body.

## 4. Exposure record and code

```ts
export type ExposureOutcome = 'navigated' | 'refused' | 'timedOut';
export type ExposureWebview = `chrome-${number}` | 'webkit';
export interface ExposureRecord {
  readonly outcome: ExposureOutcome;
  readonly visible: { readonly android: boolean; readonly ios: boolean }; // both false unless navigated
  readonly canaryReachedNative: boolean;
  readonly webview: ExposureWebview | null;  // null: page said 'unknown' or anything off /^(chrome-\d{1,4}|webkit)$/
}
export type ExposureVisible = 'none' | 'android' | 'ios' | 'android+ios';
export type ExposureCode = 'refused' | 'timed-out' | `navigated:${ExposureVisible}` | `navigated:${ExposureVisible}+canary`;
export function exposureCode(record: ExposureRecord): ExposureCode;
```

- Grammar: `refused` | `timed-out` | `navigated:<none|android|ios|android+ios>[+canary]`. `+canary` only on
  `navigated` (a canary beside `refused`/`timedOut` is kept in the record, not in the code).
- `unknown` engine: `record.webview === null`. **chain-6 MUST NOT upload a record whose `webview` is null.**
- A report with an outcome outside the three is ignored (no record).
- The hook fires once per report; if the canary arrives AFTER the report, it fires again with
  `canaryReachedNative: true` (a changed result; chain-6's dedupe by `(message, exposure, webview)` sees a new code).

## 5. The single exposure call site (chain-6 hooks the upload here)

`src/host/launcher/runtime-channel.ts`:

```ts
export type RuntimeSurface = 'pool' | 'dev-probe' | 'netdeny-probe';
export function onExposure(record: ExposureRecord, surface: RuntimeSurface): void;
// today: log.info(CHANNELS.app /* 'whim' */, 'bridge-exposure', { exposure: exposureCode(record), webview: record.webview ?? 'unknown', canaryReachedNative, surface })
export function createRuntimeChannel(surface: RuntimeSurface): RuntimeChannel; // NativeWhimRandom + both hooks
export function useRuntimeChannel(channel: RuntimeChannel): RuntimeChannelSnapshot; // useSyncExternalStore
```

Every channel's `hooks.exposure` calls `onExposure`; nothing else reads exposure. There is no `diagnostics`
log channel: the record is logged on `whim` at `info` (not uploaded by the error-only transport).

## 6. Where it shows

- DevProbeScreen bar: `bridge: android <absent|present/removed|present/NOT removed>, ios …` (from
  `HostState.bridge: BridgeRecord | null`, the trusted verdict's `bridge` field) · `dropped: <n>` ·
  `exposure: <pending|pending (canary reached native)|<code> · visible android=<b> ios=<b> · canary=<b> · <webview|unknown>>`.
- Pool: `info` `whim` `'runtime webview dropped unsigned messages'` `{webKey, count}` when a slot's WebView
  unmounts with `count > 0`.

## 7. Test helpers (`src/host/launcher/test/native-host.tsx`)

- `WebView` mock reports `onLoadStart` once at mount (no host listens); `nativeLoadStart(web, url?)` plays a
  later one (the iOS/Android spurious event) through the element's `onLoadStart` if any; auth injections go to `authInjections` (global) and
  the host element's `authInjected` prop, never to `injectedScripts` / `injected`.
- `pageToken(web): string` — token of `web`'s last recorded `auth` (throws if none).
- `signed(tokenOrWeb, frame | string): string` — `W1.<token>.<JSON or the string>`.
- `secureRandom: { mode: 'ok' | 'fails' | 'throws'; calls }` — the registered `WhimRandom` stub
  (`fails` → null, `throws` → throws). Module-missing is not playable in the bundled suite (the codegen
  default export is read once at import); it is covered on `RuntimeChannel(null)` in the pure suite.
- `changing-in-use-ui.suite.tsx`: `pageOf(web): HeldPage {onMessage, token}`, `send(page, frame)`.
