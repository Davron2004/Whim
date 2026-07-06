# Handoff: runtime-theme-delivery (chain-D)

Interface only — implementation lives in `src/runtime/web/loader.js`,
`src/host/launcher/deliver.ts`, `src/host/launcher/useMiniAppHost.ts`.

## `deliverBySourceJs` (src/host/launcher/deliver.ts)

```ts
export interface DeliverBySourceArgs {
  name: string;
  source: string;
  generation: number;
  /** Optional resolved theme, forwarded OPAQUELY — this module does not import `vc-sdk` and
   *  does not validate the shape. Caller passes an already-resolved theme; the iframe-side SDK
   *  (`sanitizeTheme`) is the trust boundary. Absent → output is byte-identical to no-theme form. */
  theme?: object;
}

export function deliverBySourceJs(args: DeliverBySourceArgs): string;
```

Emitted JS (theme present):
`window.__whimControl.reinject({reset:true,bundle:<JSON name>,bundleSource:<JSON source>,generation:<n>,theme:<JSON theme>})`

Emitted JS (theme absent): identical, minus the trailing `,theme:<JSON theme>` — no `"theme"`
substring appears anywhere in the string. `theme` is serialized with the same `JSON.stringify`
call used for every other field (no extra escaping layer); quotes/`</script>` inside a theme
value stay inside the JS string via ordinary JSON string-escaping.

## `deliverBySource` (src/host/launcher/useMiniAppHost.ts)

```ts
deliverBySource: (record: AppRecord, source: string, engineAppId?: string, theme?: object) => void;
```

Threads `theme` straight into `deliverBySourceJs({ name, source, generation, theme })`. No other
behavior changed — `bind()`, generation counting, and `BackPolicy` are untouched.

## `globalThis.__WHIM_THEME__` (src/runtime/web/loader.js)

On the `__whimHostInit` frame (`{__whimHostInit:true, nonce, gen, theme?}`), if `msg.theme` is a
non-null object, the loader installs it as `globalThis.__WHIM_THEME__ = Object.freeze(msg.theme)`
— best-effort (wrapped in try/catch), executed BEFORE `post('ready', ...)` and before the
channel-(a) baked-bundle mount fallback in the same handler, so it is always in place before any
bundle can mount. Absent or non-object `theme` → no global is installed at all (not even
`undefined`); the SDK-side resolver (`tokens.ts`, chain-A) treats a missing global exactly like
an invalid one and falls back to `DEFAULT_THEME`. The loader performs NO validation of the
theme's contents — that sanitization happens once, iframe-side, in `sanitizeTheme` (chain-A);
the loader only gates on "is it a non-null object."

## Pending (NOT done by this chain)

Task 4.4 — `build/assemble.mjs` must read `theme` off the `reinject(...)` options object the
outer page already builds and forward it as the `theme` field of the `__whimHostInit` frame it
posts to the iframe on hello. `build/build.mjs` must register `style-gallery` in `APPS` +
`bundles` (chain-G concern, unrelated to theme wiring). Both files are hook-protected
(`.claude/hooks/protect-harness.sh`) — main-thread-only, not implementer-dispatchable. Until 4.4
lands, `theme` passed into `deliverBySourceJs`/`deliverBySource` is plumbed correctly but never
reaches the iframe — `__WHIM_THEME__` is never installed and every app renders with SDK defaults.
