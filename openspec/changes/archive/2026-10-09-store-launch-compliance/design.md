## Context

The launcher was built for LAN development. The user types a server address, and the first prompt goes out with no disclosure (research.md A "Settings"). No report path exists anywhere, and neither does link handling (A "Links/clipboard"). Every non-2xx response already surfaces its `hint`, but only as a failure screen. Clarify and rewrite failures open one with no record. A build-step failure, even one that happens before the stream opens, settles a `failed` pending record and leaves a ghost tile (B "Failure mapping"). The `XMLHttpRequest` transport can't read response headers at all (B "Error taxonomy").

Four outside inputs shape this change:

- **Store rules** (launch context). Apple 5.1.2(i) wants explicit permission before personal data reaches third-party AI. Guideline 4.7.1 asks for filtering, reporting and privacy, and 4.7.4 for an index plus a universal link per mini-app. Google Play wants reporting that works without leaving the app.
- **The sibling server change** (`public-generation-server`, on `integration/store-launch`). Refusals are `ApiError` bodies whose `error` belongs to the closed `ServiceRefusalCode` enum: `payload_too_large`, `daily_limit`, `device_busy`, `server_busy`, `content_policy`, `policy_unavailable`, and `budget_exhausted` (503, no `Retry-After`). `Retry-After` is integer seconds and appears only on `daily_limit` and global-ceiling `server_busy`. `POST /v1/report` takes `ReportRequest` and answers `202 { reportId }` (research.md C).
- **`server-connectivity`**, which lands before this change: the `probeServer` helper, the session `connectivity` state, `markOnline()`, the startup retry loop, and Settings' save-time probe. This change gates all of it on consent rather than duplicating any of it.
- **Shell conventions.** Screens are members of one `Screen` union and own their hardware back. `SHELL_PALETTE` and SDK tokens are the only style source. Strings live in `COPY` under the product-verbs guard, and pure logic sits in RN-free siblings so the Node suites can test it (A "Screen model", "Shell design system", "Tests").

## Goals / Non-Goals

**Goals:**
- A reviewer on a fresh install sees usable example apps, meets a clear disclosure the moment they try to make an app, and can verify that declining leaves everything local working.
- Nothing leaves the phone before consent except a report the user sends by hand, and that property holds structurally, not by convention.
- Every refusal the public server can return lands on a screen where the user can act, in the server's own words, and never becomes a ghost tile for a build that never started.
- Report, privacy, support and app-link paths all work from a build nobody has configured.
- The native and hosting work for universal links is written down precisely enough that the platform change and ops can do it without reading launcher code.

**Non-Goals:**
- Server code, contract shapes, native project files, signing, icons, iOS back handling (all owned elsewhere).
- An age gate, accounts, BYOK, sharing apps between people.
- A one-tap Copy button for links (it needs a native clipboard module; see Open Questions).
- Reporting from the clarify or plan steps.

## Decisions

### D1. Consent is asked at the first data-sending action, not at first launch
The consent screen opens in place of the requested screen when the user taps the composer row, "Prompt again" (long-press or orb), history's "Change it from here", or Retry on a failed build. After agreeing, that action continues.

A first-launch onboarding wall was the alternative, and I rejected it. The app-launcher spec already promises that "a fresh install is not empty" and that its examples launch at once. The brief requires that declining keep apps usable, which a wall at launch fights. And 5.1.2(i) asks for permission "before" sharing, which a just-in-time screen satisfies at exactly the point where the question makes sense. Review notes tell the reviewer to tap `Describe an app…`, so they meet it within one tap.

### D2. No request of any kind before consent, enforced by a branded options type
`clarifyPrompt`, `rewritePrompt` and `generateApp` take `ConsentedClientOptions`, a branded `ClientOptions` whose only constructor, `consentedClientOptions(status, baseUrl, deviceId)`, returns `null` unless consent is granted and current. The shell's existing `clientOptions` memo (research.md A "Integration points") becomes that call. `server-connectivity`'s startup effect keys on it, so no probe runs before consent, granting starts the probe, and revoking cancels it. `SettingsScreen` gets a `canProbe` flag for its save-time probe. `sendReport` takes plain `ClientOptions`, which is the one deliberate exception (D3).

I considered a consent check at each call site. A missed site would compile and ship; with the brand it's a type error. I also considered letting the `/healthz` probe run before consent, since it carries no content or device ID. I rejected that too. The review notes' claim that nothing leaves the phone until you agree is only true, and only testable, if it has no asterisk, and the cost is an offline indicator that can't appear before consent. Before consent there's nothing to be offline for.

### D3. Reports don't require AI consent
A report goes to AnyCognition's server and nowhere else. The sibling server runs its content policy (the only model-adjacent work on the request path) on clarify, rewrite and generate, not on `/v1/report`. The report sheet is itself an itemised disclosure, and Send is an explicit act. Gating reports behind AI consent would stop someone who declined from reporting a seeded example they find objectionable, which is the opposite of what Google's policy asks for.

### D4. Consent storage and versioning
The grant is stored at `whim.ai-consent:v1` as `{ version, grantedAt }` (ISO timestamp) on the shared `whim.launcher` KV backend, following the `whim.<name>:v1` convention (research.md A "Settings"). Revoking deletes the key. A decline is not persisted, because the gate asks again next time and there's nothing to remember. `AI_CONSENT_VERSION` lives in `release-config.ts` (D6). A stored grant with a lower version reads as `outdated`, and the ask screen adds one line saying what Whim sends has changed. Unreadable JSON reads as `absent`, so a bad record fails closed.

`consentStatus(kv)` returns `{ kind: 'granted'; grantedAt } | { kind: 'absent' } | { kind: 'outdated' }`.

### D5. The consent screen is a full-screen `Screen` kind with two modes
The new `consent` member of the `Screen` union has `mode: 'ask'`, which carries a `continuation` (`{ kind: 'compose'; editing?: InstalledApp } | { kind: 'retry'; record: PendingBuildRecord }`) and a `returnTo`, or `mode: 'review'`, opened from Settings. Its own `BackHandler` declines, which means `returnTo` in ask mode (Home when that was a running app, because a torn-down realm isn't resumed) and Settings in review mode. It sits inside the `ScreenBoundary` switch like every screen (A "Screen model").

In review mode with consent on, `Keep AI features on` is the large button and `Turn off AI features` is plain text beneath it, the same safe-large shape History's confirm sheet uses. In review mode with consent off, `Turn on AI features` grants and returns to Settings.

A bottom sheet was the other option. A legal disclosure with a list, a link and two outcomes is cramped in one, and a sheet reads as chrome you can swipe away. That's the wrong signal for a permission.

Disclosure copy (final wording lands in `copy.ts` under the voice rules and the guard, which forbids `generation`, `snapshot` and similar):

- Title: `Before Whim makes apps for you`
- Lead: `To make or change an app, Whim sends your request to AnyCognition's server. The server uses AI models from other companies, reached through OpenRouter, to write the app.`
- `What gets sent`: `What you ask for: your description, your answers to Whim's questions, and the plan you approve` / `When you change an app: its code, its current description, and the layout of its saved data` / `An anonymous ID for this phone, used for daily limits`
- `What never gets sent`: `Anything you save inside your apps`
- Footnote: `You can turn this off in Settings. Apps you already have keep working either way.`
- Link `Privacy policy`; actions `Agree and continue`, `Not now`.

The edit items come from what the code actually sends. Generate carries source, manifest and both schemas (research.md B "Payloads"), and clarify and rewrite also carry the app's name, collection and field names, and its current description (research.md C).

### D6. One domain constant, one release-config module
`src/host/launcher/release-config.ts` exports `WHIM_DOMAIN = 'example.com'` and a frozen `RELEASE` object: `serverUrl: https://api.whim.${WHIM_DOMAIN}`, `webHost: whim.${WHIM_DOMAIN}`, `webOrigin`, `privacyPolicyUrl: ${webOrigin}/privacy`, `supportUrl: ${webOrigin}/support`, `appLinkBase: ${webOrigin}/a/`. It also exports `AI_CONSENT_VERSION = 1`. The file imports nothing from React Native. `example.com` is IANA-reserved, so a build that ships with the placeholder can never reach someone else's server. A source-scan suite fails when any other launcher file contains the domain value or a `whim.` URL literal, and that locks the one-constant rule the spec states.

`server-address.ts` gains `effectiveServerUrl(kv)` (the saved override, else `RELEASE.serverUrl`) and `clearServerUrl(kv)`.

I rejected build-time injection through a Babel plugin or env. `babel.config.js` is Class 2, the domain is a one-line edit either way, and v1 needs no per-environment builds because the Advanced override (D7) covers staging.

### D7. Settings sections, with the server address under a collapsed Advanced
The order is AI features (state line plus a row that opens review mode), then Highlighting (unchanged), then About (`Privacy policy`, `Support`, both through `Linking.openURL`), then Advanced. Advanced is one row that expands inline, and it renders already open when an override is saved. Its open state isn't persisted. Inside it are the server field, `server-connectivity`'s inline probe result (or, without consent, the neutral `Checked once AI features are on` line), and `Use Whim's server`, which appears only while an override exists. The field's placeholder shows the default host.

Why keep the field at all, and why not behind the developer flag? The build this project actually runs is a release build with that flag off (app-launcher "Production builds hide developer diagnostics surfaces"). TestFlight testers, Play closed-track testers and the 2026-09-24 demo may all need to point at a staging or LAN server without a rebuild. Collapsing it keeps store users and reviewers from meeting a field that means nothing to them, while anyone with an override still sees it at once.

### D8. Refusals are matched on the contract enum, with a typecheck-exhaustive table
`GenerationClientError` gains `code?: string` (the `ApiError` identifier) and `retryAfterSeconds?: number` (a positive integer only). Both are filled in `httpErrorFrom`. For the XHR path, `finishHttpError` exposes `xhr.getResponseHeader('Retry-After')` through the fake response it builds, which today has no headers (research.md B "Error taxonomy").

`service-refusal.ts` imports `ServiceRefusalCode` type-only, keeping zod out of Metro. It declares:

```ts
type RefusalRule = { landing: 'text' | 'sender'; tone: 'danger' | 'neutral' };
const REFUSAL_RULES: { readonly [K in ServiceRefusalCode]: RefusalRule };
```

A mapped type makes a missing member a compile error. A Node suite, which can import zod, compares the table's keys with the real `ServiceRefusalCode.options`, so the table can't carry an extra key either. `serviceRefusalOf(err)` returns `{ code, hint, status, retryAfterSeconds? }` only for `kind: 'http'` with an own-key hit in the table and a non-empty hint. It never matches on status or hint text.

| code | status | landing | tone | Retry-After |
|---|---|---|---|---|
| `content_policy` | 422 | text | danger | never |
| `payload_too_large` | 413 | text | danger | never |
| `policy_unavailable` | 503 | sender | neutral | no |
| `budget_exhausted` | 503 | sender | neutral | never |
| `daily_limit` | 429 | sender | neutral | yes |
| `device_busy` | 429 | sender | neutral | never |
| `server_busy` | 429 | sender | neutral | on the global ceiling |

### D9. Where a refusal lands
`text` lands where the refused words are edited: compose for clarify or rewrite, plan for a plan-started generate. `sender` lands on the step whose primary action sent the request: compose for clarify, compose or clarify for rewrite (whichever `Continue` was tapped), and plan for generate. A pure `refusalLanding(request, sentFrom, code)` states the rule once.

The alternative was the existing failure screen with its rephrase path. A refusal is the server declining to start, not a run that broke, and the most common one (`content_policy` on compose) would cost an extra screen and a tap to get back to the text. The shell already opens the next step at once under its own loading state and fires the request after (research.md C), so a refusal is simply a return transition, just like a back.

### D10. A refused build and its pending record
The record is still written before the request, since prompt-flow and pending-builds both require the id up front. When the generate request is refused, one of three things happens:

- It was a fresh attempt from `Build it`, and `ctl.detached` is still false. The record and its journal are deleted exactly as cancel deletes them, and the flow returns to plan with the notice.
- The user already tapped `Leave it running`. The record settles `failed` with the hint as its reason, so the ghost tile explains itself.
- It was a Retry from the failure screen. The record settles `failed` with the hint as its reason, and the failure screen stays, with Retry gated.

Two alternatives lost. Writing the record only once the stream opens contradicts the id-up-front requirements and the ghost transmute. Holding plan in a busy state until a new "stream accepted" transport signal fires avoids a brief build-screen frame before a refusal, but it breaks the shell's rule that "the wait is that screen, never a grey button" and adds a transport callback for this one case.

### D11. Retry-After gating
The landing screen's state holds `retryAt = receivedAt + seconds * 1000`. The primary action is disabled with its label kept, and a single `setTimeout` re-enables it; nothing is sent automatically. `retryLine(retryAt, now, formatTime)` is pure and takes an injected `Intl.DateTimeFormat` time formatter. It returns seconds under a minute, minutes under an hour, `after <time>` for later the same local day, and `tomorrow after <time>` beyond that. When `Intl` is missing it falls back to `in about N hours`. The window isn't persisted, because the server stays authoritative and simply refuses again with a fresh value.

### D12. One notice component
`ServiceNotice.tsx` renders the hint as plain `Text` (never through `WhimProse`: the hint is neither COPY nor user or agent prose), plus the optional retry line, in a card-surface panel toned `danger` or neutral from `SHELL_PALETTE`. It sits directly above the primary action on compose, clarify, plan and the failure screen. A text refusal clears when the text changes (a compose edit, or a saved plan row edit). A sender refusal clears when its window ends or the user leaves the step. `errorReason` keeps mapping hint-less errors to the generic copy sentence, so a transport message can never become a reason.

### D13. Report entry points
- **Orb.** `report` joins `ORB_ACTIONS`, and `ORB_ROW_TINT`/`ORB_ROW_GLYPH` are `Record<OrbActionId, …>`, so the table can't be left incomplete (A "Per-app actions"). It fits the orb's "cheap, undoable" rule because opening the sheet does nothing on its own. Sending is a deliberate second step on a surface you can read.
- **Done step.** A plain-text action under the two fixed destinations (research.md B "Action areas").
- **History header.** Reports the version the user is on. History rows are capped at two actions by version-history, so no row gains one.

The long-press sheet stays out, because it already holds six rows once `App link` joins, and the orb covers "inside the app", where the content is actually seen.

All three entries build their draft with `reportDraftFor(entry, access)` in a non-RN module: `InstalledApp.name`, `StoreAccess.activeDescription(entry)`, and `StoreAccess.activeSource(entry)` (research.md B "Report data").

### D14. Report sheet mechanics
- **`SheetModal.tsx`.** One new primitive: an RN `Modal` (transparent) that rises from the bottom on `MOTION.sheetRise`, closes on a scrim tap and on `onRequestClose`, avoids the keyboard, and respects the bottom safe-area inset. `ReportSheet` and `AppLinkSheet` use it. It's a `Modal` because that layers above the `WebView` and the orb.
- **Back over a running app.** Android delivers hardware back to a visible `Modal`'s `onRequestClose` instead of `BackHandler` listeners. `back-policy.ts`'s reducer also gains an `overlayOpen` input that yields `close-overlay` without forwarding or counting the press, so the Node suite can state the rule. `useMiniAppHost` passes the flag.
- **Payload.** `report-payload.ts` exports `buildReportRequest(draft): ReportRequest | null`, which is null without a reason, trims the note and omits it when empty, cuts the note to 1000 and the app name to 200, and drops prompt or source when switched off or absent. It also exports `reportPreview(request)`, whose rows derive from the request itself, and `reportLogFields(request, outcome)`, which returns only the reason, byte sizes and outcome. The sheet renders the preview from the same value it posts, so they can't disagree. A Node suite parses built requests with the real zod `ReportRequest`, which ties the mirrored 1000 and 200 bounds to the contract.
- **States.** Idle and draft, then sending (`One moment`), then thanks (`Thanks. The Whim team reads every report.`, `Done`), or failed-with-draft. A refusal uses `ServiceNotice` and the D11 window. `payload_too_large` keeps the switches live. Anything else shows `Couldn't send the report. Check your connection and try again.` The `reportId` isn't shown, because it's an internal identifier.
- **Logging and client.** Report note text joins the logging seam's redacted keys. `sendReport(options, body, signal)` sits beside `clarifyPrompt` and uses `requestHeaders` and `httpErrorFrom`, with a structural guard on the `202` body.

### D15. App link handling
- **`app-link.ts`** builds `RELEASE.appLinkBase + encodeURIComponent(id)` and parses strictly: https, exact host (case-insensitive), `/a/<one segment>` with an optional trailing slash, query and fragment ignored. Launcher ids come in three shapes, `app-<base36>-<rand>`, fixture seed ids, and forks `repo__lineage` (research.md C), and the round-trip suite covers all three.
- **`link-routing.ts`** is RN-free. `resolveAppLink(id, apps, pending)` returns `open`, `building`, `failed` or `missing`. `linkExitFor(screen)` maps each screen to its safe exit (app exits, build leaves running, failure goes Back, flow steps go Home, consent declines, sheet closes, Settings and History go Home). A pending-link holder keeps the last link until the grid is ready.
- **`LauncherRoot.tsx`** reads `Linking.getInitialURL()` once ready and subscribes to `Linking.addEventListener('url')`. A rejected URL logs only its scheme and host. A link to the app already open changes nothing. `link-missing` is a new `Screen` kind rendered by `AppLinkMissingScreen.tsx` (`This app lives on another phone` / `Apps made with Whim stay on the phone that made them, so this link only opens there.` / `Back to your apps`).

### D16. Revealing a link without a clipboard dependency
`App link` joins the installed-tile long-press sheet and opens `AppLinkSheet`: the app's name, the link as `<Text selectable>`, and `Opens <name> on this phone. Press and hold the link to copy it.`

Guideline 4.7.4 asks for an index "of software and metadata" that "must include universal links". The home grid is that index, so the link belongs on each grid entry's own action sheet rather than inside the running app.

RN core hasn't shipped a clipboard API since 0.60. A clipboard module is a new native dependency (`package.json` is Class 2, plus iOS pods), which belongs with the platform change. Selectable text gets the system copy menu on both platforms for free. I rejected `Share` because sharing apps between people is out of scope, and a shared link only ever reaches the "another phone" screen.

### D17. Platform and ops contract for app links
The universal-link chain copies this section into `handoff/app-link-platform.md` for the platform change and ops.

**The JS side provides.** It accepts only `https://whim.<domain>/a/<encodeURIComponent(launcherId)>`, reads the cold-start URL from `Linking.getInitialURL()`, and handles warm links from `Linking`'s `url` event. It needs the full https URL, unmodified.

**The iOS project must provide:**
- The `com.apple.developer.associated-domains` entitlement with `applinks:whim.<domain>` on the `Whim` target, through a `Whim.entitlements` file wired by `CODE_SIGN_ENTITLEMENTS`, and the Associated Domains capability on App ID `com.anycognition.whim`.
- In `AppDelegate.swift`, forwarding of `application(_:continue:restorationHandler:)` to `RCTLinkingManager.application(_:continue:restorationHandler:)` and of `application(_:open:options:)` to `RCTLinkingManager.application(_:open:options:)`. The current `AppDelegate` on `integration/store-launch` has neither (research.md C), so without them no link reaches JS.
- `launchOptions` still passed to `factory.startReactNative` (it is today), so a cold-start universal link surfaces through `getInitialURL()`.

**The Android project must provide:**
- On `MainActivity`, a second intent filter beside MAIN/LAUNCHER: `android:autoVerify="true"`, action `android.intent.action.VIEW`, categories `DEFAULT` and `BROWSABLE`, data `android:scheme="https" android:host="whim.<domain>" android:pathPrefix="/a/"`.
- `MainActivity` stays `launchMode="singleTask"`, so a warm link arrives through `onNewIntent` as a `url` event instead of a second activity.

**Ops must serve on `https://whim.<domain>`:**
- `/.well-known/apple-app-site-association`: HTTPS, no redirects, no extension, `Content-Type: application/json`, body `{"applinks":{"details":[{"appIDs":["<TEAM_ID>.com.anycognition.whim"],"components":[{"/":"/a/*"}]}]}}`.
- `/.well-known/assetlinks.json`: `[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"android_app","package_name":"com.anycognition.whim","sha256_cert_fingerprints":["<Play App Signing key SHA-256>","<upload key SHA-256>"]}}]`. The Play signing key is mandatory, because Play re-signs the app.
- `/a/<anything>`: a 200 HTML fallback for phones without Whim, saying the app opens only on the phone that made it, with store links.
- `/privacy` and `/support`: 200 HTML. The privacy policy must say what the consent screen says (D5), plus report retention.

The domain has to change in lockstep in three places: `WHIM_DOMAIN`, the entitlement, and the intent filter. The review-notes checklist carries that.

### D18. Store review notes and the decision log
`docs/store/review-notes.md` holds:

1. **How to try Whim.** No login. Examples on the grid; `Describe an app…` opens consent, then compose, clarify, plan, `Build it` (about a minute), `Open it`; the orb's `Report this app`; long-press, `App link`.
2. **Guideline 4.7.**
   - The mini apps are HTML5/JS in a sandboxed WebView (opaque-origin iframe, CSP without `unsafe-eval`, no network).
   - 4.7.1: the consent screen; server-side filtering of every prompt before any model call, failing closed; in-app reporting with an operator response window; no users to block, since there are no accounts, no sharing and no user-to-user content.
   - 4.7.2: the nine bridge syscalls listed by name and effect (`storage.kv.*`, `storage.records.*`, `diag.echo`, `cues.haptic`, `cues.sound`), all local, with no camera, location, contacts, files or network.
   - 4.7.3: no data or permissions reach individual mini apps.
   - 4.7.4: the home grid is the index, and every app has a universal link.
   - 4.7.5: a 13+ rating, kept by prompt filtering.
3. **Guideline 2.5.2 context.** Mini apps don't change Whim's native features or download native code.
4. **What leaves the phone and when**, which is nothing from inside apps.
5. **Store forms.** Draft answers for Apple App Privacy and the age rating, Google Play Data safety (prompts and reports as user-generated content, the device ID, sharing with AI providers for app functionality, encrypted in transit), the AI-generated content declaration, content rating, target audience 13+, and the Device and Network Abuse exemption for JavaScript in a webview. Every form answer is marked as a draft to confirm in the console.
6. **Pre-submission checklist.** Real domain in all three places, AASA and assetlinks validated, privacy and support pages live and matching D5, consent version bumped if the disclosure changed, production `/healthz` verified.

One appended `docs/decisions.md` entry records D1, D2, D3, D6, D7, D10 and D16.

## Risks / Trade-offs

- [The placeholder domain ships] → The IANA-reserved placeholder can't reach a stranger's server, the suite keeps the domain a one-line edit, and the checklist gates submission on it.
- [Native link host drifts from `WHIM_DOMAIN`] → The D17 lockstep note plus the checklist. Native files can't import the JS constant.
- [A refused build flashes the build screen for a frame] → Accepted (D10). It's the same return pattern clarify uses today. If on-device review flags it, a follow-up can add a stream-accepted signal.
- [No offline indicator before consent] → Accepted (D2). Before consent the app has no server to be offline from.
- [Consent copy and the hosted privacy policy disagree] → The checklist requires them to match, and the rule to bump `AI_CONSENT_VERSION` when the disclosure changes sits beside the constant.
- [A server adds a refusal code] → The mapped-type table fails the typecheck, and the zod-options suite fails on extra or missing keys. The launcher can't silently fall back to a failure screen.
- [`Retry-After` values of hours on `daily_limit`] → Shown as a local time, and the window is screen-local. Coming back later, the server answers again.
- [Selectable text is a weaker copy affordance than a button] → Open question. The platform change can add a clipboard module and swap in a button without touching the grammar.
- [A link arriving mid-compose loses typed text] → Same as going Home today. Links are rare during composition.
- [The `Modal` back interception differs on iOS] → iOS has no hardware back, and the reducer's `overlayOpen` input states the rule for Android. It needs an on-device check.

## Migration Plan

- No data migration. `whim.ai-consent:v1` is a new key. An existing saved `whim.server-url:v1` becomes an override, and Advanced renders open for those users.
- Existing dev installs meet the consent screen on their next composer tap. That's expected.
- Apply order: `server-connectivity`, then `public-generation-server`'s contract work (for the `ServiceRefusalCode` and `ReportRequest` types), then this change, all on `integration/store-launch`.
- Rollback is reverting the merge. Older builds ignore the consent key.

## Open Questions

- The real domain. Default: `example.com` until AnyCognition picks one.
- A one-tap Copy button (needs `@react-native-clipboard/clipboard` in the platform change). Default: selectable text, no new dependency.
- Reporting from the clarify and plan steps, whose questions and plan rows are AI-written text. Default: not in v1. The server filters prompts before model work, and the user can edit or back out.
- The response window promised in review notes for reports. Default: a marked blank for the operator to fill.
- Whether turning consent off should also reset the anonymous device ID. Default: no.
- Moving `HistoryScreen`'s confirm sheet and `RunDetailsSheet` onto `SheetModal`. Default: not in this change.
- Naming individual AI providers in the consent copy. Default: name OpenRouter only, because the models are env-configured server-side (launch context), and the hosted privacy policy lists the current providers.
