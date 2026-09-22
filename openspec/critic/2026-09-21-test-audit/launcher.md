# Test audit — slice `launcher` (src/host/launcher/test, 77 files)

All paths below are relative to `src/host/launcher/`. Line numbers are HEAD of `integration/store-launch`.

## 0. The one fact that changes most verdicts in this slice

PR #35 added `test/react-screen.ts` + `test/native-host.tsx` + `test/native-storage.ts` and aliased
`react-native`, `react-native-webview`, `react-native-safe-area-context`, `react-native-mmkv` and
`op-sqlite` to them in `test/run.mjs:30-36`. Since then the Node suite **renders real screens and the
whole `LauncherRoot`** under `react-test-renderer`, with a `fetch` stub and `StoreAccess.prototype`
spies (`test/launcher-interactions.suite.tsx`, `test/app-link-ui.suite.tsx:76-93`,
`test/connectivity-ux.suite.tsx:106-143`, `test/screen-controls.suite.tsx`).

So the rationale in about 18 suite headers is now false: "`X.tsx` imports react-native and cannot be
rendered under Node, so we assert against its source" (e.g. `test/bundle-error-watchdog.suite.ts:8`,
`test/boot-state.suite.ts:6`, `test/fork-question-ui.suite.ts:4`, `test/prompt-flow-wiring.suite.ts:8`).
That rationale produced about 140 source-grep tests and about 15 tiny pure helpers split out of
components just so something could go red and then green. Nearly all of them can now be rendered
tests, and the few that pin real data or consent invariants **should** be. The only missing test
infrastructure is a `WebView` shim that uses `forwardRef` to expose a recording `injectJavaScript`,
and that tests can drive through `onMessage`/`onLoadEnd` (`native-host.tsx:17` is a plain host
component, so `useMiniAppHost.ts:147`'s `webRef.current?.injectJavaScript` is a silent no-op today).

## 1. Totals

Estimated lines. "Rewrite/merge" means lines replaced by a rewritten test or collapsed into another one.

| | files | lines | est. DELETE | est. REWRITE/MERGE | share not keepable as-is |
|---|---:|---:|---:|---:|---:|
| NEW | 30 | 2,905 | 316 | 389 | 24% |
| CHANGED | 17 | 5,960 | 748 | 993 | 29% |
| OLD | 30 | 5,623 | 357 | 599 | 17% |
| **Total** | **77** | **14,488** | **~1,420** | **~1,980** | **~23%** |

Six of the 77 are markdown acceptance checklists (491 lines) and six are runner/helpers (384 lines).
Of about 13.6k lines of actual suite code, about 25% should go or be rewritten. That's below the owner's
"half" guess. The big old suites (store-access, run-journal, xhr-transport, generation-client,
build-lifecycle, pending-builds, app-index) mostly test persisted state and the wire format for real.
The rot is concentrated in (a) source-grep blocks inside otherwise good suites and (b) the NEW batch
of tiny extracted-helper suites. **By test count** the picture is closer to the owner's intuition:
about 140 of about 830 `h.test` call sites are source greps, and roughly another 90 are tautologies,
change detectors, or duplicates.

---

## 2. Per-file findings (worst first)

### test/prompt-flow-wiring.suite.ts (885 lines, CHANGED) — REWRITE
Lines 1-317 and 816-855 are fine behavioral tests. Lines 319-884 are 30 source-grep tests
over `LauncherRoot.tsx`/`HomeScreen.tsx`/`FailureScreen.tsx`/`build-lifecycle.ts`: slices sized by
`indexOf` between two declaration names, then `.includes` of exact code text.
- [SOURCE-GREP] home/history entry points go through the consent gate (L328-350) — REWRITE. Asserts `/onCreate=\{\(\) => openWithConsent\(\{ kind: 'compose' \}\)\}/.test(rootSrc)`. It passes if a new entry point bypasses the gate, and fails on a harmless reformat. Consent is compliance-critical, so rewrite rather than delete: render `LauncherRoot` with no grant and trigger each entry (`HomeScreen.onCreate`, `onPromptAgain(app)`, History `onChangeIt`, orb change on `MiniAppView`, failure-screen Retry). Assert a `ConsentScreen` renders and `fetch` saw zero `/v1/*` calls. Press agree and assert `ComposeStep` is scoped to the app (or the Retry runs). This one test replaces consent-flow, consent-options, resolve-options and this block.
- [SOURCE-GREP][CHANGE-DETECTOR] approve-order (L352-369) — REWRITE. `h.eq((rootSrc.match(/generateApp\(/g) ?? []).length, 1, …)`: counts call sites. Rewrite: drive compose → clarify → plan in `LauncherRoot` with a fetch stub and assert no `/v1/generate` request before `PlanStep.props.onBuild()`.
- [SOURCE-GREP] cancel wiring + post-await guard counts (L371-392, L441-458) — REWRITE/DUPLICATE. `h.eq(writes(composeFn).length - guarded(composeFn).length, 1, …)` pins how many `setScreen(` calls are not wrapped. Mostly already done behaviorally by `test/app-link-ui.suite.tsx:94-123` (leave clarify → `signal.aborted`, late response can't navigate). Extend that test to leave via `ComposeStep/ClarifyStep.onBack` and `PlanStep.onBack`. Delete the grep.
- [SOURCE-GREP] rewrite/about wiring (L394-424) — REWRITE. `/rewritePrompt\([\s\S]*?buildRewriteAppContext\(plan\.editing, aboutFor\(plan\.editing\)\)/`. The real bug (description resolved after Continue gets dropped) needs a rendered test: Prompt again on an installed app whose `activeDescription` resolves late, then assert the captured `/v1/clarify` and `/v1/rewrite` bodies carry `app.description`.
- [SOURCE-GREP] sentFrom wiring (L426-439) — REWRITE (with `refusal-target`): `composeFn.includes("await openPlan(loading, 'compose');")`. See `refusal-target` for the rendered test.
- [SOURCE-GREP] build screen reads only `stage` (L460-464) — REWRITE (small). `!/event\.text\b/.test(attemptFn)`. Privacy-ish. Stream a token whose text is `SENTINEL` and assert it isn't in the rendered tree.
- [SOURCE-GREP] leave-it-running / hardware back (L472-496) — REWRITE. `!backFn.includes('abortLiveAttempt')`. `test/launcher-interactions.suite.tsx:45-46` already calls `BuildStep.onBack` mid-stream and the attempt still delivers. Add: the captured fetch signal is not aborted, and with details open `hardwareBack()` closes the sheet instead of leaving. L492-496 (`!rootSrc.includes("if (timeline === null) return undefined;")`) is a RED-GREEN-ARTIFACT — DELETE.
- [SOURCE-GREP] delivery routing (L498-512) — **CONDITIONAL DELETE: only after the shareData property is moved (see verification.md)**. Everything except shareData is already behavioral in `test/build-lifecycle.suite.ts:119-326`. The one user-data property only pinned here is `deliverFn.includes('access.fork(editing, undefined, { shareData: true })')`, because the build-lifecycle fakes ignore fork's options (`fork: async () => forked`, `test/build-lifecycle.suite.ts:228,295`). Move it: make the fake record its `opts` and assert `{ shareData: true }` (or use a real `StoreAccess` and assert `fork.storageGroupId === parent.id`).
- [SOURCE-GREP][CHANGE-DETECTOR] launch demotion order (L526-538) — REWRITE. `at('pending.demoteBuildingToInterrupted()') < at('seedFirstRun(')`. Rendered: put a `building` record in `native-storage`, render `LauncherRoot`, assert `HomeScreen.props.pending[0].state === 'interrupted'`. Drop the `h.eq(... demoteBuildingToInterrupted\( ... , 1)` call-site count.
- [SOURCE-GREP] reattach / failure hydration / exits / live Discard / concurrent refs (L540-694) — REWRITE. About 150 lines of `actionsFn.includes('...(settled != null ? { onDismiss: () => onDismissPending(settled) } : {})')`. Rendered replacements: (1) build, leave running, tap the ghost: `BuildStep` renders and fetch was called once; (2) failed ghost: `FailureScreen` hydrates (already `test/app-link-ui.suite.tsx:64-67`), Discard deletes both the pending record and `journal:<id>` from `native-storage`, Back deletes neither; (3) a clarify failure's `FailureScreen` has no Discard button; (4) two overlapping attempts (leave running, then build again): cancelling the newer ghost aborts its signal, not the older one.
- [SOURCE-GREP][CHANGE-DETECTOR] journal call sites (L702-798) — REWRITE, part DELETE. `h.eq((attemptFn.match(/terminalCounts\(\)/g) ?? []).length, 5, …)` fails when a sixth ending is added, which is a CHANGE-DETECTOR, so DELETE it. Rendered replacements: after a delivered result `lastrun:<id>` exists and `journal:<id>` doesn't; after Discard both are gone; after deleting the app `lastrun:<id>` is gone. The store behavior itself is already in `test/run-journal.suite.ts`.
- [SOURCE-GREP] liveness in memory (L800-807), highlighting provider mounted (L809-812) — DELETE. `rootSrc.includes('const signalsRef = useRef<RunSignals | null>(null);')` pins a variable declaration. If highlighting matters, render Settings → switch off → a `WhimProse` renders flat.
- [SOURCE-GREP] consent gate (L857-874) and retired two-stage flow (L876-884) — **CONDITIONAL DELETE: only after the rendered consent rewrite lands (see verification.md)**. `!fs.existsSync(.../PromptScreen.tsx)` and `!('promptTitleNew' in COPY)` are RED-GREEN-ARTIFACTs. The gate is covered by the rendered consent rewrite above.
- [DUPLICATE] envelope tests (L236-267) — MERGE into `test/prompt-envelope.suite.ts`. L250-263 repeat `test/prompt-envelope.suite.ts:14-34` verbatim. L238-239 assert `v === PROMPT_ENVELOPE_VERSION` and then `v === 2`. L265-267 (`!promptEnvelope(...).includes('lineage')`) is VACUOUS: the function never writes such a key.
- [DUPLICATE] clarify 502 (L178-187) is the stronger form of `test/prompt-flow-screens.suite.ts:151-156`. Keep this one.

### test/bundle-error-watchdog.suite.ts (215 lines, CHANGED) — REWRITE
Entirely source-grep over `useMiniAppHost.ts`/`MiniAppView.tsx`, protecting real recovery behavior (a bundle that never paints or throws fatally must not leave a dark realm). Examples: `/setWebKey\(\(?k\)? *=> *k *\+ *1\)/.test(handlerRegion)` (L98), `h.ok(/\breturn;/.test(beforeSetS), …)` (L139), `fatalSet.includes("'bundle'")` (L145).
- [SOURCE-GREP] recovery branch, Retry, `clearLastError`, `webKey` (L60-124) — REWRITE. With a `forwardRef` WebView shim, render `MiniAppView` for an installed app (spy on `StoreAccess.prototype.activeBundle` as `test/app-link-ui.suite.tsx:81-83` does). Fire a trusted `{kind:'error', payload:{where:'bundle'}}` through the WebView's `onMessage`. Assert `COPY.appErrorTitle` renders and the raw error string doesn't. Press Retry: a new WebView instance mounts (`findByType('WebView') !==` the old one) and the error surface is gone. Press Back: `onExit` is called.
- [SOURCE-GREP] fatal-where narrowing (L126-159) — REWRITE. Fire `{where:'probes'}`: no takeover, and a `log.buffer` record appears.
- [SOURCE-GREP] deadline lifecycle (L161-214) — REWRITE with `captureTimeouts()`: after `onLoadEnd` the 6000 ms deadline is pending; unmount, exit and Retry each clear it; a fired deadline shows the app-error surface.
- [DOC-TRIPWIRE] `!/nothing.*was lost/i.test(COPY.appErrorBody)` (L79-83) — DELETE. Wordings like "no data lost" still pass.

### test/theme.suite.ts (243 lines, CHANGED) — DELETE (keep one check, moved)
- [RED-GREEN-ARTIFACT][SOURCE-GREP] `#4f46e5` / `Space Grotesk` nowhere under `src/` (L56-68) — DELETE. Bans two specific retired values; a newcomer couldn't say why these two.
- [TAUTOLOGY] SHELL_PALETTE maps roles (L71-82) — DELETE. `h.eq(p.bg, t.colors.bg, …)` restates `theme.ts:26-35` line for line.
- [CHANGE-DETECTOR] `inkAlpha(0.58) === 'rgba(23,23,26,0.58)'` (L85-87) — DELETE. Pins the ink hex. The helper is three parse lines.
- [DUPLICATE] `sanitizeTheme` / `appColor` (L90-143) — DELETE. SDK behavior, already covered more strongly in `src/sdk/test/theme.acceptance.ts:41-62,89-131`.
- [SOURCE-GREP][RED-GREEN-ARTIFACT] "never names ShellPalette / useTheme / ThemePref / shellPalette()" (L158-210) — DELETE. Tripwire against re-adding a removed feature; the allowlisted snippets make it break on edits to `theme.ts`.
- [SOURCE-GREP] emoji without U+FE0E (L225-242) — KEEP-FIX. A real iOS rendering invariant nothing else catches. Move it to `checks/` (it scans all of `src/host`, not just theme).

### test/consent-screen-actions.suite.ts (68 lines, NEW) — DELETE
- [TAUTOLOGY] "has a non-granting exit" / "at most one row grants" (L22-31) — DELETE. They read the table's own self-declared `grants` flag, which `ConsentScreen.tsx` never consults: the handler is chosen by action name (`ConsentScreen.tsx:81-83,124,136`). If `decline` were wired to `onAgree`, these still pass. `hasNonGrantingExit` exists only for this test (no production caller).
- [CHANGE-DETECTOR] exact row tables (L33-67) — DELETE. `h.eq(rows, [{ action: 'agree', kind: 'primary', grants: true }, …])` repeats `consent-screen-actions.ts:29-46`.
- [DUPLICATE] The regression named in the header (review-off mode had no exit) is caught by the rendered `test/screen-controls.suite.tsx:60-71`, which presses `COPY.consentDecline` and hardware back and asserts `[closed, changes] === [2, 0]`.

### test/probe-gate.suite.ts (41 lines, NEW) — DELETE
- [RED-GREEN-ARTIFACT][DUPLICATE] all three tests (L24-40). `probeGateFor` is `options == null ? idle : probe` (`probe-gate.ts:19-21`). The behavior is already rendered: no probe before consent and a probe after it (`test/connectivity-ux.suite.tsx:106-143`: `requested … consented ? ['/healthz'] : []`), revoke cancels (`test/launcher-interactions.suite.tsx:51-53`: `clock.count(2000) === 0`).

### test/resolve-options.suite.ts (23 lines, NEW) — DELETE
- [RED-GREEN-ARTIFACT] L12-22 test `memo ?? live` (`resolve-options.ts:13-15`). The header admits the real regression lives at the `LauncherRoot` call site, which this can't reach. That's covered by the consent rewrite under `prompt-flow-wiring`.

### test/consent-flow.suite.ts (94 lines, NEW) — REWRITE
- [RED-GREEN-ARTIFACT][VACUOUS] 15 generated tests across five "entry points" (L48-77). `entryDecision` is `status.kind === 'granted' ? continue : ask` (`consent-flow.ts:39-41`). The five names are decoration: three of the five continuations are identical objects, and nothing ties them to real entry points. The realistic bug (an entry point calling `openCompose` directly) passes. Rewrite as the rendered per-entry-point consent test described under `prompt-flow-wiring` L328-350.
- `declineTarget` (L79-93): keep one rendered case. Decline on consent opened from a running app lands on Home (`test/connectivity-ux.suite.tsx:133-134` covers only the Home origin).

### test/consent-options.suite.ts (40 lines, NEW) — REWRITE
- [RED-GREEN-ARTIFACT] L20-39 test a three-call composition (`consent-options.ts:20-22`). The bug in the header (Ask mode's "Agree and continue" sees the pre-grant memo) lives in `LauncherRoot`. Rewrite: render `LauncherRoot` with no grant, `onCreate` → `ConsentScreen` → `onAgree`. Assert `ComposeStep` renders in the same act, and continuing to clarify issues a `/v1/clarify` request with the device header. No rendered test does ask → agree → continue today; `test/launcher-interactions.suite.tsx:54-55` only agrees from Settings review mode.

### test/refusal-target.suite.ts (61 lines, NEW) — REWRITE
- [DUPLICATE] landing kinds (L33-60) repeat `test/refusal-landing.suite.ts:28-42`. The unique part (text/questions/notice carried over) is small.
- The regression the header names (zero-question clarify followed by a sender refusal must land on compose, not clarify) is in `LauncherRoot`'s choice of `sentFrom`, and this test passes `sentFrom` in by hand. Rewrite rendered, in the `launcher-interactions` style: fetch stub returns `{questions:[]}` for `/clarify` and `429 {error:'server_busy',hint}` for `/rewrite`, then assert `ComposeStep` renders with the hint and `ClarifyStep` isn't mounted. That replaces this file and `prompt-flow-wiring` L426-439.

### test/settings-sections.suite.ts (20 lines, NEW) — MERGE
- [RED-GREEN-ARTIFACT] `advancedInitiallyOpen` is `override != null && override.trim().length > 0` (L11-19). The open-with-override case is already rendered implicitly: `test/settings-screen.suite.tsx:37-40` finds the `TextInput` that only renders when Advanced is open (`SettingsScreen.tsx:207-212`). Merge one rendered case into settings-screen: `serverUrl` undefined → no `TextInput` until Advanced is pressed.

### test/realm-delivery.suite.ts (73 lines, OLD) — REWRITE
- [RED-GREEN-ARTIFACT] `loadEndAction` table (L26-42) tests `prev === key ? 'duplicate' : 'deliver'`.
- [SOURCE-GREP] `guardIdx < deliverIdx`, `/deliveredKey\.current = webKey/` (L44-72). The bug is real: a double Android `onLoadEnd` recreated the realm under a running app and crashed app open. Rewrite with the `forwardRef` WebView shim: render `MiniAppView`, fire `onLoadEnd` twice, assert exactly one reinject was injected. Then Retry (new key), fire `onLoadEnd`, assert a second delivery.

### test/fork-question-ui.suite.ts (56 lines, OLD) — REWRITE (user-data invariant)
- [SOURCE-GREP] L25-55: `/COPY\.forkShareData[\s\S]{0,120}onFork\(a, \{ shareData: true \}\)/.test(homeScreenSrc)` and `launcherRootSrc.includes('await access.fork(app, undefined, opts);')`. Whether a fork shares the original's storage is a data invariant, so rewrite rather than delete. Render `HomeScreen`, long-press → press `COPY.actionFork` → assert the share/fresh sheet shows and `onFork` wasn't called. Press `COPY.forkShareData` → `onFork(app, {shareData:true})`; `forkStartFresh` → `{shareData:false}`. At the root, spy on `StoreAccess.prototype.fork` (as `test/app-link-ui.suite.tsx:81` does for `activeBundle`) and assert the options arrive unchanged.

### test/launch-failure-ui.suite.ts (64 lines, OLD) — REWRITE
- [SOURCE-GREP] L23-53: `failBranch.includes('launchFailed: true')` finds one line containing two substrings. Rewrite rendered: `MiniAppView` for a record whose schema conflicts, so `launchApp` refuses (engine factory injected or `op-sqlite` shim backed by `node:sqlite`). Assert the `COPY.launchFailedTitle` surface, no raw `kind`/`hint`, and Back calls `onExit`.
- [KEEP-FIX] copy vocabulary (L55-63). Fine, but fold into `test/product-verbs.suite.ts`'s FORBIDDEN list (it lacks `schema`, `database`, `storage`, `clone`, `link`).

### test/tile-colour.suite.ts (351 lines, OLD) — REWRITE (partly DELETE)
L52-157 (tileColor/lift) and L297-343 (`homeGridCellWidth`, including the property loop) are good.
- [VACUOUS] determinism (L100-104) and "extra fields ignored" (L107-116) — DELETE. Any implementation that reads `.tileColor` passes.
- [TAUTOLOGY] grid and prose agree for a declared colour (L119-127) — DELETE. It feeds `gridColour` into the prose app and reads the same value back. L129-135 (both fall back to `appColor`) is meaningful — keep.
- [SOURCE-GREP][CHANGE-DETECTOR] AppTile/DoneStep/HomeScreen geometry (L160-292) — mostly DELETE: `/padding: 9,/.test(styleBlock(src,'tile'))`, `/rgba\(255,255,255,0\.16\)/`, `/borderRadius: 32,/`, `h.eq(primary, '52', …)`, `/GLOW_ALPHA_HEX = '4d';/`. They pin pixel constants from a design mockup and break on every design tweak. REWRITE only the two real rules as rendered style checks: (a) `<AppTile size="done">` fill and glow use `tileColor(name, manifest)`, and a plain tile never picks up a done style; (b) a ghost alert paints a border, never a fill.

### test/prompt-flow-screens.suite.ts (617 lines, CHANGED) — REWRITE (JSX half)
L92-360 and L391-447 exercise the pure flow machine and are good. Problems:
- [DUPLICATE] L146-149 repeats L135-144 (`stepAfterClarifyExchange([]) === 'plan'`) — DELETE.
- [RED-GREEN-ARTIFACT][DUPLICATE] `buildBackAction`/`planBackAction` (L363-375) are two-valued ternaries. The plan case is rendered in `test/screen-controls.suite.tsx:72-88` — DELETE both; add "hardware back with details open closes the sheet" to the rendered build tests.
- [CHANGE-DETECTOR] `primaryActionLabel` copy table plus `!('flowBusy' in COPY)` (L379-389), and `BUILD_STEPS === [COPY…]` (L402-408), assert constants equal their literals — DELETE.
- [KEEP-FIX] progress fractions (L425-440): keep "never reaches 1" and monotonic, drop the exact `0.125/0.375/0.625/0.875` pins.
- [SOURCE-GREP] JSX claims (L451-596, 18 tests) — REWRITE about 7, DELETE the rest. Examples: `/onPress=\{\(\) => onChangeText\(chip\)\}/.test(composeSrc)` (L459), `/color:\s*SHELL_COLORS\.yours/` (L471), `!/log|terminal/i.test(buildSrc)` (L544, matches any "dialog"/"catalog"), `/width: APP_TILE_SIZE, height: APP_TILE_SIZE/` (L592). All these screens are already rendered in `test/screen-controls.suite.tsx:36-41`. Rendered replacements: pressing a chip calls `onChangeText(chip)` and not `onContinue`; `editing` hides the chips; `ClarifyStep`/`PlanStep` with `loading` render no primary button; tapping a plan row shows a `TextInput`, Save calls `onChangeRow(i, text)`, Cancel doesn't; `DoneStep` Open vs Back call different callbacks; the `BuildStep` details button calls `onShowDetails`. DELETE the style/font/skeleton-geometry and retired-API greps (L469-473, L540-557, L565-568, L577-581, L590-596).
- [TAUTOLOGY] "every string exists in COPY" (L598-616) — DELETE. `COPY[key]` over an `as const` key list is already a type error if a key is missing.

### test/orb-menu.suite.ts (197 lines, CHANGED) — REWRITE (mostly DELETE)
L64-102 (tap counts persist, per-action, corrupt value) are good.
- [CHANGE-DETECTOR] `ids === ['change','home','versions','report']` (L33) — KEEP-FIX: keep "no destructive id or label", drop the exact list.
- [TAUTOLOGY] labels come from COPY (L44-49); [CHANGE-DETECTOR] glyph-colour table (L56-61) — DELETE.
- [RED-GREEN-ARTIFACT][SOURCE-GREP] no hold-arming, no wheel/wedge, no "hold to flick", no "count" word, FloatingExit gone, right-anchored, `inkAlpha(0.58)` (L126-156, L181-196) — DELETE. `!/\bcount\b/i.test(orbCode)` and `!/setTimeout/.test(orbCode)` guard features that were never built.
- [SOURCE-GREP] "instrumented before anything else", "scrim tap never instruments", "actions reach real callbacks" (L158-179) — REWRITE rendered. `test/screen-controls.suite.tsx:104-113` already renders `Orb` and presses Home. Extend: press each action → its callback fires once and `orb-action-count:<id>` increments in `native-storage`; open then dismiss via the scrim → no count.

### test/screen-exits.suite.ts (247 lines, CHANGED) — MERGE/DELETE
- [TAUTOLOGY] `frameEdgesFor`, 13 generated tests (L115-136): `const expected = kind === 'app' || kind === 'dev' ? ['top'] : ['top','bottom']` is `screen-exits.ts:41-43` copied. DELETE.
- [TAUTOLOGY] "invoking the passed-through onLeave calls the spy once" (L183-207) is implied by L140-160 (`seen === onLeave`) — DELETE.
- [DUPLICATE] "changed screen resets the boundary with onLeave given" (L209-236) repeats `test/observability-ui.suite.ts:163-191` — DELETE.
- [DUPLICATE] `bindSystemBack` unsubscribe (L79-85) is `test/screen-controls.suite.tsx:57` (`backListenerCount() === 0` after unmount) — DELETE. Keep L58-77 and the real once-per-mount test L91-111.
- [SOURCE-GREP] no direct `BackHandler.addEventListener` outside the two adapters (L238-245) — KEEP-FIX: a legitimate standing rule, but it scans only the top-level directory. Make it a `no-restricted-properties` lint rule (protected config, needs human bootstrap).
- Structure: this file silently runs `runScreenControlTests` (L1, L246) and re-sets `IS_REACT_ACT_ENVIRONMENT` (L16). Wire screen-controls from `acceptance.ts` directly.

### test/boot-state.suite.ts (358 lines, CHANGED) — REWRITE (containment-adjacent; don't delete)
KEEP: `hasPainted`/`miniAppSurface` (L64-100), `paintAccepted` trust fence (L135-142), and `createStartupDeadline` with a fake clock (L221-348).
- [SOURCE-GREP] boot surface over a mounted WebView (L102-112), `bind()` resets `paintMs` (L125-131) — REWRITE rendered: `MiniAppView` before any paint shows `COPY.appBootLabel` **and** a mounted `WebView`; after a trusted paint frame the label is gone.
- [SOURCE-GREP][CHANGE-DETECTOR] boot styles have no raw literals, `decls.length === 4` (L114-123) — DELETE.
- [SOURCE-GREP][TAUTOLOGY] paint is not generation-fenced (L147-219) — REWRITE. Greps minified strings out of the generated `runtime-html.ts`, host `useRef(1)`, `++genCounter.current`. `h.ok(!paintForward.includes('GEN'))` (L154) checks a string literal defined two lines earlier, so it can't fail. `firstRealPaint` then goes through `paintAccepted`, which never reads `generation`, so L177-178 pass by construction. The real invariant (a trusted paint with realm generation 1 completes startup while the host counter is 2; an untrusted one doesn't disarm the deadline) is containment-adjacent (`CLAUDE.md`: only nonce-authenticated frames are trusted). Rewrite as a rendered `useMiniAppHost` test that delivers, then feeds `onMessage` a `{kind:'paint',trusted:true,payload:{generation:1,mountToFirstPaintMs:5}}` frame (assert running) and a forged `trusted:false` frame (assert still booting, deadline still pending). Also keep one assertion that the **built** outer page forwards `paint` with `trusted:true`; that belongs in the Chromium `bridge:invariants` (OWNER-ONLY), not a string grep here.
- [DOC-TRIPWIRE] boot copy has no mechanism words (L350-357) — DELETE (low value; `product-verbs` covers the pattern).

### test/failure-screen.suite.ts (240 lines, CHANGED) — REWRITE (half)
KEEP: attempt segments and label (L39-57), checklist rows including the leak test (L128-172), `logWebViewError` redaction (L206-230).
- [SOURCE-GREP] attempt row optional, rendered only for count > 0 (L59-69) — REWRITE: render `FailureScreen` with `observedRepairAttempts` absent vs 2 and assert the row's presence.
- [CHANGE-DETECTOR][SOURCE-GREP] exits (L73-124): `h.eq(COPY.failureBack, 'Back to your apps')`, `/color: p\.danger \}\]\}>\{COPY\.failureDismiss\}/`, `/onDismiss == null \? styles\.actionLast : null/`. REWRITE: with an `onDismiss` spy, the Discard button calls `onDismiss` and Back calls `onBack`; `hardwareBack()` calls `onBack`, never `onDismiss`; without `onDismiss`, no `COPY.failureDismiss` text renders. L94-103 is mostly a DUPLICATE of `test/screen-controls.suite.tsx:41,45-58` (failure Back plus system back).
- [SOURCE-GREP] prop type admits only `hint` (L174-185) — DELETE (TypeScript enforces this; L161-172 covers the behavior). Token/style literal scan (L189-204) — DELETE. `onError` routes through the seam (L232-239) — DELETE, or replace with a `no-console` lint rule.

### test/grid-composition.suite.ts (285 lines, OLD) — REWRITE (source-grep half)
KEEP: `composeGrid` (L70-154) and `tilePillFor` (L262-284).
- [RED-GREEN-ARTIFACT] "ghost carries its state verbatim — red-check aid" (L157-162) — DELETE (reference pass-through). [DUPLICATE] L171-174 is implied by L165-169 — DELETE.
- [SOURCE-GREP] HomeScreen/AppTile wiring (L177-259). REWRITE the behavior: render `HomeScreen` with `pending` (already done in `test/app-link-ui.suite.tsx:38-47`); tapping a ghost calls `onOpenPending`, never `onOpen`; long-pressing a building ghost offers Cancel and not Dismiss, a failed ghost the reverse; a tappable pill calls `onOpenPending(rebuild)`. DELETE the style and constant pins: `/tileGhost: \{ opacity: /`, `/tileGhostAlert: \{ borderColor: STATUS_COLORS\.broken \}/`, `h.eq((src.match(/onPress=/g) ?? []).length, 1, …)`, the `TILE_PILL` tone table (L245-253), and `/return \(/g` count === 2 (L242).

### test/run-timeline.suite.ts (442 lines, OLD) — REWRITE (tail)
KEEP: the pure `runTimelineRows` tests (L63-271, L314-355).
- [SOURCE-GREP] failure screen's what-happened section (L282-310) — REWRITE rendered: `FailureScreen` with no `journal` and `attemptStarted` false renders no `COPY.timelineTitle`; with a journal it renders the rows **in addition to** the checklist.
- [SOURCE-GREP][CHANGE-DETECTOR] L357-441: `h.eq((rootSrc.match(/journal\.get\(/g) ?? []).length, 2, …)`, `/SHEET_MAX_HEIGHT_FRACTION\s*=\s*0\.72/`, `!/timelineOverlay/.test(rootSrc)`, token/style scans. DELETE. [DUPLICATE] L434-441 repeats `test/prompt-flow-screens.suite.ts:552-557`. REWRITE only "details reads the journal on open, back closes the sheet, never cancels" as a rendered `LauncherRoot` build test.

### test/report-send.suite.ts (79 lines, NEW) — REWRITE (sendDisabled/settleSend)
- [RED-GREEN-ARTIFACT] `sendDisabled` (L20-34) tests `request === null || phase === 'sending' || gated`, and `settleSend` (L36-57) a two-branch map, both split out of `ReportSheet.tsx` so they'd run in Node. `ReportSheet` is never rendered anywhere. Rewrite: render `ReportSheet` with a fetch stub. Send is disabled with no reason; pick one → enabled; a `413 payload_too_large` returns to an editable draft with the notice and the same reason; a 202 shows thanks; the `log.buffer` record for a failure carries `outcome: '413'`.
- KEEP: `sendFailureOutcome` (L59-78).

### test/dev-probe-back-button.suite.ts (57 lines, CHANGED) — DELETE (E1)
- [SOURCE-GREP] E1 (L32-56): `src.includes('onPress={host.exit}')` plus a per-line filter. The screen is dev-only (`LauncherRoot.tsx:1727`, gated by `devLogOverlayEnabled(__DEV__)`). DELETE. KEEP F3 (L24-31).

### test/unmount-teardown.suite.ts (97 lines, OLD) — REWRITE (static half)
- KEEP: `tearDownLiveRealm` (L28-47). [VACUOUS] L50-56 ends with `h.ok(true, …)`; the real check is "didn't throw", which `h.test` already reports. KEEP-FIX: drop the `h.ok(true)`.
- [SOURCE-GREP] L60-96 requires the unmount effect to be a **one-liner** (`l.includes('useEffect') && l.includes('tearDownLiveRealm') && l.includes('[]')`), so reformatting breaks it. It guards a user-data handle leak. Rewrite: render a component that uses `useMiniAppHost`, bind a realm with a spy engine, unmount, and assert `engine.close()` was called and `onExit` wasn't.

### test/release-config.suite.ts (85 lines, NEW) — DELETE (3 of 5)
- [RED-GREEN-ARTIFACT] domain is not `example.com` (L42-45) — DELETE. the repo-root `checks/test/release/domain-lockstep.suite.ts` already ties the domain to the native config.
- [TAUTOLOGY] `RELEASE.serverUrl === \`https://api.whim.${WHIM_DOMAIN}\`` and friends (L47-55) — DELETE (re-derives `release-config.ts:18-31`).
- [CHANGE-DETECTOR] `h.eq(AI_CONSENT_VERSION, 1, …)` (L57-60) — DELETE. The spec says to bump the version when data use changes, so this fails on exactly the change the constant exists for.
- KEEP-FIX: the domain-literal scan (L62-75) is a legitimate standing-invariant static check, but it belongs in `checks/`.

### test/app-busy.suite.ts (240 lines, OLD) — MERGE + REWRITE
KEEP the `runAppOp`/`AppBusy` behavior.
- [DUPLICATE] fork re-trigger (L85-112) and delete re-trigger (L114-133) are the same test; open-failure (L62-83), delete-failure (L135-152) and throws (L154-165) are the same test. MERGE each group into one test parametrized over `op`.
- [SOURCE-GREP] wiring (L211-234): `/const appOps = useRef\(new AppBusy\(\)\)\.current/`, `busyStyle.includes('opacity')`. REWRITE rendered: in `LauncherRoot`, hold a spied `StoreAccess.prototype.fork` open, long-press → Fork → share-data twice. Assert fork was called once and the sheet's Fork row reads `COPY.actionForkBusy` and is disabled.
- [CHANGE-DETECTOR] `COPY.actionForkBusy === 'Forking…'` (L236-239) — DELETE.

### test/history-wait.suite.ts (258 lines, OLD) — MERGE + REWRITE
- [RED-GREEN-ARTIFACT] `HISTORY_LOADING` equals its literal (L73-75) — DELETE.
- [DUPLICATE] restore double-submit (L144-165) and copy double-submit (L167-193) — MERGE into one test parametrized over the operation.
- [SOURCE-GREP] HistoryScreen wiring (L221-250), e.g. `/skeletonHeadline: \{ height: TYPE_SCALE\.bodyEmphatic\.lineHeight/`. REWRITE rendered: `HistoryScreen` (already rendered in `test/screen-controls.suite.tsx:33`) with a real `StoreAccess`. It shows the loading label before `timeline` resolves; a second tap on Restore while the first rollback is held calls `access.rollback` once.
- [CHANGE-DETECTOR] copy literals (L252-257) — DELETE.
- [TIMING/VACUOUS] `within()` (L61-66) `unref`s its timer, so a deadlocked promise exits the process with code 13 and no test named. That's the exact failure `test/store-access.suite.ts:46-58` documents and avoids. KEEP-FIX.

### test/observability-ui.suite.ts (328 lines, CHANGED) — KEEP-FIX + REWRITE (source-grep tail)
KEEP: boundary behavior (L74-205), overlay list/filter/format (L233-270), and the gate plus `SHOW_DEV_LOG_OVERLAY === false` (L274-280). The latter is a ship-safety constant.
- [SOURCE-GREP][CHANGE-DETECTOR] error-screen tokens (L209-218) — DELETE.
- [SOURCE-GREP] "thrown error never rendered" (L220-229): the `{error}` regex misses `{err.message}` or `{String(e)}`. REWRITE: render `ScreenErrorFallback` (already rendered in `test/screen-controls.suite.tsx:92`) through `ScreenBoundary` with a child that throws `'SENTINEL'`, and assert `'SENTINEL'` is absent from the tree.
- [SOURCE-GREP] overlay gate lives in the component (L282-299) — REWRITE: render `<DevLogOverlay/>`. `run.mjs` defines `__DEV__` as false, so the render must be empty.
- KEEP-FIX: the bare-`__DEV__` scan (L306-327) is legitimate but reads only `LauncherRoot.tsx`. Widen it to every launcher source file or make it a lint rule.

### test/whim-prose.suite.ts (415 lines, OLD) — KEEP-FIX (tests `src/host/ui/whim-prose`, not the launcher)
- [RED-GREEN-ARTIFACT] "same input lexes the same way" (L87-93) — DELETE (it's a pure function).
- [CHANGE-DETECTOR][DUPLICATE] `CLASS_PRIORITY` ordering (L226-233) is covered behaviorally by L235-252 — DELETE the constant check.
- [DUPLICATE] L320-330 repeats the flatten check from L170-181 (same `everyCopyString()`). MERGE, keeping the "no `!`" voice check.
- [TAUTOLOGY][CHANGE-DETECTOR] required COPY keys, `!('flowBusy' in COPY)`, and exact build-step strings (L332-355) — DELETE (typecheck already guarantees the keys; the steps duplicate `test/prompt-flow-screens.suite.ts:402-408`).
- [SOURCE-GREP] placement (L397-414): KEEP "vc-sdk never imports whim-prose" (a standing SDK boundary). The "stays pure, no react-native import" check is no longer enforced by the runner, since it aliases react-native. REWRITE the component greps: render `WhimProse` under `HighlightingProvider enabled={false}` and assert no styled spans.
- Suggest moving this file to `src/host/ui/whim-prose/test/`.

### test/connectivity-ux.suite.tsx (145 lines, NEW) — DELETE (L35-51)
- [TAUTOLOGY] L37 and L46: `h.eq(showOfflineIndicator(state), state === 'offline', …)` and `h.eq(showServerUnreachableNotice(state, configured), state === 'offline' && configured, …)` recompute `connectivity-ux.ts:17-27` exactly. The rendered tests below them (L53-143) are the real coverage. KEEP those.

### test/generation-client.suite.ts (753 lines, CHANGED) — KEEP-FIX (merge duplicates)
Strong wire-level suite. Fixes:
- [DUPLICATE] failure frame (L406-416) and runnable result (L512-526) are inside the one-of-each test at L386-404. "No onKeepalive" (L439-444) is L418-425. DELETE all three.
- [VACUOUS relative to its claim] "one valid instance of EVERY union arm" (L386-404) uses a hand-written list, so a new contract arm isn't covered, contradicting the comment at L380-385. KEEP-FIX: build the list from `GenerationEvent.options.map(o => o.shape.type.value)` (`contract/src/index.ts:255`) and fail on any arm without a fixture.
- [DUPLICATE] Retry-After cases (L313-347) and `test/transport-shared.suite.ts:43-67` test the same `retryAfterSecondsOf`. MERGE into one table (`'120','0','-5','3.5','soon','1e3','0x10',HTTP-date`) in one place.
- [RED-GREEN-ARTIFACT] `!logged.message.includes('whim:gen')` (L694) guards a retired prefix — drop that one line.
- [TIMING] L656 `await sleep(WINDOW_MS * 4)`. Passes robustly, but on a loaded runner it could miss the regression. Low priority.

### test/xhr-transport.suite.ts (748 lines, CHANGED) — KEEP-FIX
- [DUPLICATE] "negative control" (L729-747) is L198-224 (first event before completion) — DELETE. Keepalive skip (L226-235) is inside L240-251 — DELETE.
- [DUPLICATE] XHR Retry-After (L470-520) and the parity test (L522-559): keep the parity test and the XHR header-read case (L470-491), drop L493-520.
- [TIMING] wall-clock backstop `elapsedMs < 2000` (L704). The byte counter (L696-700) is the discriminating check. The backstop is generous, but it's still a wall-clock assertion.
- [RED-GREEN-ARTIFACT] `!logged.message.includes('whim:gen')` (L439) — drop.

### test/build-lifecycle.suite.ts (752 lines, CHANGED) — KEEP-FIX
- [DATA] behind-tip rebuild tests (L218-236, L272-304) use `fork: async () => forked`, which ignores options. The continuation's `shareData: true` (decision #52 D2) is only locked by the source grep in `prompt-flow-wiring:504`. KEEP-FIX: record `opts` and assert `{ shareData: true }`.
- [RED-GREEN-ARTIFACT] `refusedGenerateOutcome` truth table (L475-486) — DELETE; L490-523 exercise it through `settleRefusedGenerate`.
- [DUPLICATE] cancel/dismiss (L455-471) test `dropPendingBuild`, which is `pending.delete(id)` (`build-lifecycle.ts:346-348`); covered by `test/pending-builds.suite.ts:71-80`. DELETE. Payload round-trip (L748-751) repeats L422-438 — DELETE.
- [TAUTOLOGY] `withKeepalive` "journal byte-for-byte unchanged" (L743): the function takes no journal. Its other assertions repeat `test/run-signals.suite.ts:131-139` — DELETE L731-744.

### test/run-journal.suite.ts (504 lines, OLD) — KEEP-FIX (merge)
Real persisted-state behavior.
- [DUPLICATE] the throttle is tested four times: L107-118, L120-134, L136-148, L266-285. MERGE into a boundary test (L136-148) and a latest-counts test (L266-285). The read-count test (L150-181) is distinct — keep it.
- [DUPLICATE] "failed run's journal stays readable" (L463-469) is implied by the terminal tests. "Different attempts are independent" (L482-488) and "success terminal carries no failure field" (L240-246) are trivial. DELETE.

### test/history-logic.suite.ts (303 lines, OLD) — KEEP-FIX
- [DUPLICATE] "make this version its own app" (L150-160) is `test/store-access.suite.ts:250-262` (§21). `storedSummary` parse (L55-58) is inside L74-83. DELETE both.
- [SOURCE-GREP] HistoryScreen/HomeScreen/LauncherRoot wiring (L284-302): `src.includes('() => access.rollback(app, row.id)')`. REWRITE rendered: tapping a row expands it without calling rollback; Go back → confirm → `rollback(app, row.id)`; Start a copy → `fork(app, row.id)`.

### test/settings-probe.suite.ts (167 lines, NEW) — KEEP-FIX
- [DUPLICATE] "empty address resets to idle" (L130-145) is `test/settings-screen.suite.tsx:50-53` — DELETE. Keep coalescing (L77-96), stale-result fencing (L98-128) and cancel fencing (L147-164). Those are unique.
- `FakeTimers` (L11-41) is a copy of `test/connectivity.suite.ts:27-59`. Move it to a shared helper.
- Hidden wiring: this file runs `runSettingsScreenTests` (L2, L166). Wire it from `acceptance.ts`.

### test/connectivity.suite.ts (194 lines, NEW) — KEEP-FIX
- [VACUOUS] "a loop never start()-ed publishes nothing" (L142-150). The constructor publishes nothing, so no realistic bug fails this. DELETE. The rest is good. Share `FakeTimers`.

### test/server-probe.suite.ts (121 lines, NEW) — KEEP-FIX
- [RED-GREEN-ARTIFACT] "opts is fully optional" (L102-120) tests a default parameter. The default-`fetch` path is exercised by `test/settings-screen.suite.tsx:27-59` through the real screen. DELETE.

### test/service-refusal.suite.ts (138 lines, NEW) — KEEP-FIX
- [PLATFORM/CHANGE-DETECTOR] `REFUSAL_RULES` keys equal the contract vocabulary, `realCodes.length === 7`, `includes('budget_exhausted')` (L29-35). The mapped type at `service-refusal.ts:29` already fails `tsc` on a missing or extra key, and `=== 7` breaks on a legitimate new code. DELETE.

### test/scheme-host.suite.ts (59 lines, NEW) — KEEP-FIX
- [VACUOUS vs its claim] "the reviewer's repro" (L20-26). The header says the bug only appears with React Native's `URL` polyfill, and `scheme-host.ts:5-8` says Node's `URL` never bleeds, so a `new URL(...)` implementation passes this test in Node. KEEP-FIX: add the hostile-`globalThis.URL` stub from `test/app-link.suite.ts:129-148`, and MERGE the six cases into one table. The rendered `test/app-link-ui.suite.tsx:68-71` already checks the logged `{scheme, host}` end to end.

### test/transport-shared.suite.ts (68 lines, NEW) — KEEP-FIX
- Retry-After table (L43-67): MERGE with `test/generation-client.suite.ts:313-347` (see above). `consentedClientOptions` (L19-37): KEEP, as the canonical unit test of the consent gate.

### test/link-routing.suite.ts (112 lines, NEW) — KEEP-FIX
- [CHANGE-DETECTOR] `linkExitFor` (L75-99): five one-assert tests of a switch. MERGE into one table test. The effect of each exit lives in `LauncherRoot`; only the clarify → abort case is rendered (`test/app-link-ui.suite.tsx:94-123`). Add one rendered "a link arriving on the build screen leaves the run running".
- The header comment (L4-6) says the `LauncherRoot` wiring is "source assertions in app-link-ui.suite.ts". Stale: it's rendered.

### test/app-link.suite.ts (149 lines, NEW) — KEEP-FIX
Good hostile-input suite for a deep-link parser (including the `URL`-independence proof at L129-148).
- [DUPLICATE] uppercase scheme / host / both (L59-62, L88-96) and "starts with base" (L33-35, implied by the round trips) — MERGE into one table.

### test/pending-builds.suite.ts (185 lines, OLD) — KEEP-FIX
- [TAUTOLOGY] `ghostTileColorFor(id) === appColor(id)` (L177-179) re-states the implementation. Determinism (L173-175) and "not constant" (L181-184) duplicate the SDK `appColor` tests. DELETE L172-184; hue stability that matters is in `test/build-lifecycle.suite.ts:158-196`.

### test/bundle-validity.suite.ts (44 lines, OLD) — KEEP-FIX
- [CHANGE-DETECTOR] "a comment-only mention PASSES" (L30-39) pins a known weakness. A better guard, such as a real parse, would fail it. DELETE.

### test/refusal-landing.suite.ts (87 lines, NEW) — KEEP
Minor: "expected landings cover every code exactly once" (L50-56) is META (guards the test's own fixture). Acceptable.

### test/store-access.suite.ts (560 lines, OLD) — KEEP
Minor MERGEs: §28 (L304-309) is inside §27 (L294-301); §33 (L360-365) is §14's last assert (L176). The fork-appId invariant (§12, L153-160) and the per-repo serialization tests are exactly what this slice should have.

### test/harness.ts (48 lines, OLD) — KEEP-FIX
- `ok`/`eq` don't delegate to `node:assert`, contrary to the repo's test-assertion rule (`CLAUDE.md` "Test assertions"). Sonar S2699 can't see assertions through it.
- `eq` compares with `JSON.stringify`: key-order sensitive (a harmless key reorder in the implementation fails a test) and blind to `undefined`. So every "sends no X key at all" claim made with `h.eq` passes even if the object carries `X: undefined`. Examples: `test/generation-request.suite.ts:215,220,248-250`, `test/prompt-flow-wiring.suite.ts:246`. Harmless on the wire today (JSON drops `undefined`), but the claims are weaker than written. Switch to `assert.deepStrictEqual`.

### test/acceptance.ts (146 lines, CHANGED) — KEEP-FIX
- Two suites run only through other suites (`screen-controls` via `screen-exits`, `settings-screen` via `settings-probe`). The header (L2-9) still describes the three-suite v1 launcher. The `import` for `runLauncherInteractionTests` sits above the file doc (L1).

### test/deliver-by-source.desktop.mjs (246 lines, OLD) — KEEP-FIX
Real Chromium containment parity (by-source vs baked, plus the `vc-sdk` bootstrap failing closed). [TIMING] `page.waitForTimeout(400)` (L51) is a fixed sleep. Wait on a DOM condition instead. The bootstrap fail-closed half is SDK containment and arguably belongs with `bridge:invariants`.

### Acceptance checklists (`*.spec.md`, not tests)
- `test/acceptance.spec.md` (59, OLD) — **stale**: step 1 "make your first app create tile", step 4 "floating affordance" (FloatingExit is gone; it's the orb now), step 5 fork "count starts at 0" (fork now asks share-vs-fresh), step 8 "long-press the launcher title" and "42/42".
- `test/back-policy.spec.md` (79, CHANGED) — accurate (includes `overlayOpen`).
- `test/fork-question-ui.spec.md` (40, OLD) — behavior accurate; the "static source checks" rationale is stale.
- `test/history-ui.spec.md` (94, OLD) — behavior accurate; "HistoryScreen is not rendered under Node" is stale.
- `test/installed-apps.spec.md` (165, OLD) — accurate.
- `test/shared-storage-acceptance.spec.md` (54, OLD) — §1-4 accurate; §5's "not renderable under Node" is stale.

### Keep (earn their place as-is)
- `test/error-reason.suite.ts`: honest failure reasons, no transport text.
- `test/ai-consent.suite.ts`: versioned grant, fails closed.
- `test/settings-screen.suite.tsx`: rendered save-then-probe, colours, no-consent, unmount cancel.
- `test/screen-controls.suite.tsx`: rendered exits and system back for every screen.
- `test/launcher-interactions.suite.tsx`: a late response can't validate a changed configuration.
- `test/app-link-ui.suite.tsx`: rendered cold/warm links, the rejection log, same-app remount.
- `test/report-payload.suite.ts`: contract-validated body, log fields never carry content.
- `test/back-policy.suite.ts`: the guaranteed-exit state machine.
- `test/prompt-envelope.suite.ts`: envelope parser fallbacks.
- `test/product-verbs.suite.ts`: a standing no-mechanism-vocabulary rule.
- `test/deliver.suite.ts`: size guard, TextEncoder fallback, escaping.
- `test/app-index.suite.ts`: persisted index, refcounts.
- `test/seed.suite.ts`: idempotent seeding, deleted examples stay deleted.
- `test/shared-storage.suite.ts`: real file-backed storage-group behavior.
- `test/run-signals.suite.ts`: liveness derivation and boundaries.
- `test/generation-request.suite.ts`: applied-schema union, source vs bundle, context caps.
- `test/run.mjs`, `test/react-screen.ts`, `test/native-host.tsx`, `test/native-storage.ts`, `test/fake-xhr.ts`: runner and shims (native-host needs the `forwardRef` WebView noted above).

---

## 3. Patterns

1. **SOURCE-GREP of RN components, justified by a stale "can't render under Node" premise.** About 140 tests in 22 files. The heaviest: `prompt-flow-wiring` (30), `prompt-flow-screens` (18), `bundle-error-watchdog` (12), `orb-menu` (11), `run-timeline` (10), `grid-composition` (8), `tile-colour` (7), `failure-screen` (7), `boot-state` (6). Representative: `test/prompt-flow-wiring.suite.ts:661` asserts `h.eq((rootSrc.match(/dropPendingBuild\(/g) ?? []).length, 1, …)`, a call-site count that fails on a harmless extract-function refactor and passes while Discard is wired to the wrong record. About 10 of the 140 lock real standing rules (domain literal, bare `__DEV__`, direct `BackHandler`, emoji selector, SDK→whim-prose boundary) and should become lint rules or `checks/` passes. About 55 should become rendered tests. The rest should go.
2. **Tiny helpers split out of components so a red-green test could exist (RED-GREEN-ARTIFACT/TAUTOLOGY).** About 15 helpers and 60+ test cases: `resolveOptions` (`??`), `probeGateFor`, `advancedInitiallyOpen`, `liveClientOptions`, `entryDecision` (15 generated tests), `consentScreenActions`/`hasNonGrantingExit`, `rewriteRefusalTarget`, `sendDisabled`/`settleSend`, `showOfflineIndicator`/`showServerUnreachableNotice`, `frameEdgesFor` (13 generated tests), `loadEndAction`, `buildBackAction`/`planBackAction`, `refusedGenerateOutcome`. Representative: `test/connectivity-ux.suite.tsx:46` expects `state === 'offline' && configured` from a function whose body is `connectivity === 'offline' && serverConfigured`. The real regressions these helpers were split out for live at the `LauncherRoot` call site, which none of these tests reach.
3. **CHANGE-DETECTOR on copy, style constants and call-site counts.** About 45 assertions. Representative: `test/tile-colour.suite.ts:202` `/borderRadius: 32,/.test(tileDone)`, `test/release-config.suite.ts:59` `AI_CONSENT_VERSION === 1`, `test/app-busy.suite.ts:237` `COPY.actionForkBusy === 'Forking…'`, `test/prompt-flow-wiring.suite.ts:750` `terminalCounts()` appears exactly 5 times.
4. **DUPLICATE across near-sibling files.** About 25 instances. Representative pairs: `consent-screen-actions` vs `screen-controls:60-71`; `probe-gate` vs `connectivity-ux:106-143` + `launcher-interactions:51-53`; `screen-exits:209-236` vs `observability-ui:163-191`; `theme:90-143` vs `src/sdk/test/theme.acceptance.ts`; the Retry-After table in three places (`transport-shared:43-67`, `generation-client:313-347`, `xhr-transport:493-520`); `xhr-transport:729-747` vs its own L198-224; `history-logic:150-160` vs `store-access:250-262`.
5. **RED-GREEN-ARTIFACT tripwires for removed things.** About 20 assertions. `!fs.existsSync('FloatingExit.tsx')`, `!('flowBusy' in COPY)`, `!/shellPalette\(/`, `#4f46e5` nowhere, `!logged.message.includes('whim:gen')`, `!rootSrc.includes("if (timeline === null) return undefined;")`. Each encodes the patch that removed something, not an invariant.

## 4. Incidental (not test verdicts)

- `consent-screen-actions.ts:52` `hasNonGrantingExit` has no production caller; it exists for the test. The table's `grants` flag is never read by `ConsentScreen.tsx` (the handler is chosen by action name at `:81-83`), so the table and the UI can disagree silently.
- `build-lifecycle.ts:268` `HINT_SEPARATOR = '\n'`: a server hint containing a newline is shown as one row on the live failure screen but splits into two rows once hydrated from the persisted record.
- `test/history-wait.suite.ts:64` `within()` unrefs its timer, so a deadlocked promise exits the whole suite with code 13 and no test named (the lesson `test/store-access.suite.ts:46-58` documents).
- `test/harness.ts:21-26` `eq` is JSON equality: key-order sensitive and blind to `undefined`. It also isn't `node:assert`-backed, contrary to `CLAUDE.md`.
- `native-host.tsx:17` renders `WebView` as a plain host component, so `useMiniAppHost.ts:175` `webRef.current?.injectJavaScript` is a silent no-op in every rendered test that mounts `MiniAppView` (`test/app-link-ui.suite.tsx:76-93`). Those tests prove navigation, not delivery.
- About 18 production module docs still say "RN-free: this must load under the launcher's Node acceptance suite" (e.g. `consent-options.ts:8-9`, `probe-gate.ts:7-8`). The runner now aliases react-native, so that constraint no longer exists and nothing enforces it either.
- `acceptance.ts` never imports `settings-screen.suite.tsx` or `screen-controls.suite.tsx` directly; they run only because `settings-probe` and `screen-exits` call them. Rename or split either host file and they silently stop running.
