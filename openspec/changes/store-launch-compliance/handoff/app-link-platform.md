# app-link-platform (chain-6)

Copied from design.md D17 verbatim (its own note: "The universal-link chain copies this section
into `handoff/app-link-platform.md` for the platform change and ops"). Consumed outside this
change by the platform release CLI (association files) and by ops (the pages host).

## The JS side provides

It accepts only `https://whim.<domain>/a/<encodeURIComponent(launcherId)>` (`app-link.ts`'s
`parseAppLink`), reads the cold-start URL from `Linking.getInitialURL()`, and handles warm links
from `Linking`'s `url` event (`LauncherRoot.tsx`). It needs the full https URL, unmodified — no
redirect, no rewrite, no stripped query/fragment.

## The iOS project must provide

- The `com.apple.developer.associated-domains` entitlement with `applinks:whim.<domain>` on the
  `Whim` target, through a `Whim.entitlements` file wired by `CODE_SIGN_ENTITLEMENTS`, and the
  Associated Domains capability on App ID `com.anycognition.whim`.
- In `AppDelegate.swift`, forwarding of `application(_:continue:restorationHandler:)` to
  `RCTLinkingManager.application(_:continue:restorationHandler:)` and of
  `application(_:open:options:)` to `RCTLinkingManager.application(_:open:options:)`. Already
  landed on `integration/store-launch` (native halves merged ahead of this chain).
- `launchOptions` passed to `factory.startReactNative` (already is), so a cold-start universal
  link surfaces through `getInitialURL()`.

## The Android project must provide

- On `MainActivity`, a second intent filter beside MAIN/LAUNCHER: `android:autoVerify="true"`,
  action `android.intent.action.VIEW`, categories `DEFAULT` and `BROWSABLE`, data
  `android:scheme="https" android:host="whim.<domain>" android:pathPrefix="/a/"`. Already landed.
- `MainActivity` stays `launchMode="singleTask"`, so a warm link arrives through `onNewIntent` as
  a `url` event instead of a second activity.

## Ops must serve on `https://whim.<domain>`

- `/.well-known/apple-app-site-association`: HTTPS, no redirects, no extension,
  `Content-Type: application/json`, body:
  ```json
  {"applinks":{"details":[{"appIDs":["<TEAM_ID>.com.anycognition.whim"],"components":[{"/":"/a/*"}]}]}}
  ```
- `/.well-known/assetlinks.json`:
  ```json
  [{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"android_app","package_name":"com.anycognition.whim","sha256_cert_fingerprints":["<Play App Signing key SHA-256>","<upload key SHA-256>"]}}]
  ```
  The Play signing key is mandatory — Play re-signs the app, so the upload key's fingerprint alone
  fails verification on installs from the Store.
- `/a/<anything>`: a 200 HTML fallback for phones without Whim, saying the app opens only on the
  phone that made it, with store links.
- `/privacy` and `/support`: 200 HTML. The privacy policy must say what the consent screen says
  (design D5), plus report retention.

## The three-place domain lockstep

`WHIM_DOMAIN` (`release-config.ts`), the iOS entitlement, and the Android intent filter's `host`
must change together — the review-notes pre-submission checklist (design D18 item 6) gates
submission on it. Native files cannot import the JS constant; each side's own domain literal is
the sanctioned duplication point, not a fourth one.

## What chain-6 landed on the JS side

- `app-link.ts` (chain-1, unchanged by this chain): `appLinkFor`/`parseAppLink`, the sole grammar.
- `link-routing.ts` (new, RN-free): `resolveAppLink(id, apps, pending)` →
  `{kind:'open',app} | {kind:'building'|'failed',record} | {kind:'missing'}`; `linkExitFor(screen)`
  → `'exit-app'|'leave-build'|'leave-failure'|'decline-consent'|'close-overlay'|'home'` (the
  sentinel input `'sheet'` takes unconditional precedence, mirroring `back-policy.ts`'s
  `overlayOpen`); `PendingLinkHolder` (last-wins, released once).
- `LauncherRoot.tsx`: `Linking.getInitialURL()` + the `url` listener, both funneled through
  `openAppLink(id)`, which no-ops when the id is the app already open, otherwise applies the
  current screen's safe exit and then opens the target through the SAME `onOpen`/`onOpenPending`
  handlers a tile tap uses. New `Screen` member `{ kind: 'link-missing' }`.
- `AppLinkMissingScreen.tsx`: the "lives on another phone" full screen (`Back to your apps` +
  system back, both go Home).
- `AppLinkSheet.tsx` + `HomeScreen.tsx`'s new `App link` row (installed tiles only, never ghosts):
  reveals `appLinkFor(app.id)` as selectable text through `SheetModal`.
