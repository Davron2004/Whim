# Research: store builds show and honour the server-address override (2026-10-03)

Researcher digest (read-only, no runs) plus orchestrator web research. Feeds D20, task section 12 and chain-11.

## Web research (orchestrator)

- No law or store rule forbids an app talking to a server the user chose. GDPR/Law 25/PIPEDA duties sit with
  whoever controls the data; a self-hoster is the sole controller of what reaches their server.
- Apple App Privacy: "collect" = off-device in a way that lets *you or your partners* access it. Data sent to a
  user's own server is not collected by Whim, so App Privacy / Play Data safety answers are unchanged.
- Apple 4.7 ("You are responsible for all such software offered in your app") is the review risk, since a custom
  backend serves the mini-app code. Counter: the user generates for themselves on their own server; the same
  sandbox (CSP, SDK, capability bridge, on-device age gate) applies whatever the source. Precedent: Enchanted
  (self-hosted Ollama client, App Store). Disclose the feature in review notes rather than hide it.
- Apple 2.1: self-hosted apps get rejected when the reviewer can't reach a server; Whim defaults to its hosted
  server, so the override is optional.
- Sources: developer.apple.com/app-store/review/guidelines, developer.apple.com/app-store/app-privacy-details,
  github.com/gluonfield/enchanted, support.google.com/googleplay/android-developer/answer/10144311.

## The internal-build flag (every use is the override)

- Producers: `android/app/build.gradle:174-192` (`WHIM_INTERNAL_BUILD` true for debug/offline, false release);
  `WhimAppInfoModule.kt:30`; `ios/Whim/WhimAppInfoModule.mm:28-32,58` (`#if DEBUG`); spec field
  `src/native/NativeWhimAppInfo.ts:11,23,25`.
- JS: `app-info.ts:26,86-87` (`internalBuildFrom`), `installed-app-info.ts:14-17`, `LauncherRoot.tsx:124,
  384-405,433,570,581,618,640,645,654,661,663,675,989-994,1012-1017,2534`, `consent-options.ts:27-29`,
  `diagnostics-target.ts:28,32`, `platform/install-diagnostics.ts:26,32`.
- No other feature keys on it (dev log sink uses the separate `SEND_DEV_LOGS`, `LauncherRoot.tsx:835-837`).
- Visibility: `SettingsScreen.tsx:326` (Advanced header), `:342` (field block).
- Honour gate: `server-address.ts:60-61` `serverOverride(kv,{internalBuild})`; `:70-71` `effectiveServerUrl`.

## Override today

- `server-address.ts`: `sanitizeServerUrl` (trim, strip trailing slashes; no scheme validation), key
  `whim.server-url:v1` in `whim.launcher` KV, `saveServerUrl`, `clearServerUrl`.
- Settings field saves while typing (`DebouncedSave`, `SettingsScreen.tsx:140-145,161-169`), probes `/healthz`
  only with consent granted (`server-probe.ts:83-91`), "Use Whim's server" clears it (`:370-376`).
- Copy: `copy.ts:369-389,670`; French table near `:509`/`:566`. No acknowledgement copy exists.
- Every request (clarify/rewrite/report/generate, `/healthz`, diagnostics uploads) follows
  `effectiveServerUrl`, so reports and diagnostics go to the chosen server.

## Tests asserting store-build behaviour

- Flip: `privacy-settings-ui.suite.tsx:222` ("store build: a saved override is ignored…"),
  `prompt-flow-wiring.suite.ts:122`. Flag reader: `app-info.suite.ts:119-125`.
- Prop users: `rendered-launcher.tsx:51-53,165`, `settings-screen.suite.tsx:32`, `screen-controls.suite.tsx:35`,
  `launcher-interactions.suite.tsx:43,105,142`, `privacy-settings-ui.suite.tsx:124,248-255`,
  `legal-language-ui.suite.tsx:103`, `attempt-lifecycle-ui.suite.tsx:452`, `keyboard-shell-ui.suite.tsx:223`,
  comment `logging/test/diagnostics.suite.ts:110`.
- Release check: `scripts/release/lib/android-project.ts:96-109` `checkMainNetworkConfig` fails on any
  cleartext permit in the main config; suite `checks/test/release/android-project.suite.ts:71-95,154`.
- Unread: `server/test/web-site.suite.ts`, `checks/test/repo/consent-coverage.suite.ts`.

## Specs

- Live `openspec/specs/app-launcher/spec.md:268-269` has the old pre-D10 requirement. The governing text is
  in-flight `legal-surface-v2/specs/app-launcher/spec.md:3-4,18-20,22-35` ("In internal builds, the launcher
  SHALL…"; "A store build ignores a saved override"; "A store user never meets the server field").
- `legal-surface-v2/design.md:119-123` D10.
- `platform-release-readiness/specs/native-release-config/spec.md:66-70` "Store builds carry no cleartext
  exception" (Android release no cleartext; iOS ATS local networking only), scenario "A release build refuses http".
- `beta-1/specs/app-launcher/spec.md` exists (ADDED :1, MODIFIED :54) and can host the change.

## Network security

- Android release: main `network_security_config.xml:7-9` base-config cleartext false. Debug/offline config
  (`src/debug/res/xml`, also used by offline via `build.gradle:213-217`) permits cleartext for 5 fixed hosts
  only; Android domain-config has no CIDR/wildcard, so an arbitrary LAN IP needs a base-config permit.
- iOS: one `Info.plist` (`:31-37`) `NSAllowsArbitraryLoads=false`, `NSAllowsLocalNetworking=true`; numeric and
  local hosts reachable over http in Release already. Public http hostnames are not.

## Privacy policy and disclosure

- `deploy/site/privacy.html`, `deploy/site/fr/privacy.html` (hand-authored, `{{LEGAL_*}}` slots, rendered by
  `server/src/site/legal-pages.ts:424`). Sections incl. "Who we share it with" (:126), "Your choices" (:190),
  "Changes to this policy" (:215-220, dated bullets). Check rejects `[Letter…]` draft markers, requires
  `data-category`/`data-keep` rows per manifest category.
- Manifest `contract/src/disclosure-manifest.ts` models only Whim's roles; widening (`diffManifests` :600) is
  categories/recipients/roles/purposes/keeps/consent/promises. A policy section saying the policy does not
  cover a user-chosen server changes none of them: no manifest change, no `AI_CONSENT_VERSION` bump
  (`release-config.ts:73`, = 2). Modelling the user's server as a role would force v3 + re-consent.

## Store and docs

- Stale after the change: `docs/release/mobile.md:202-204` (iOS Release ignores override), `:323-326`
  (store builds forbid cleartext overrides).
- `docs/store/review-notes.md` has no override mention; `release/store/answers.md:68-70` unchanged by the
  "collect" definition.
- Upgrade check seeds through Advanced → Server address (`upgrade-check.sh:319`, `seed.yaml:33`).

## Protected paths

None of the plausible files is in `scripts/gate.sh:23-30` CONFIG_SET. No human-bootstrap chain needed.

## Risks noted

- A legacy override saved by 382511 (whose store build still showed the field) would become active with no
  acknowledgement unless honouring is tied to an acknowledgement.
- Debounced save-while-typing means any acknowledgement gate must sit before the field is editable.
- Base-config cleartext on Android relaxes OS-level downgrade protection for every host; an app-level scheme
  rule must replace it. The sandbox WebView's CSP must keep mini-apps off the network regardless.
