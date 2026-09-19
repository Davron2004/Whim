# App Review notes (draft)

Written for whoever fills in App Store Connect's "Notes for Review" and Google Play's reviewer
guidance, and for whoever answers a reviewer's follow-up question. Everything here is checked
against the shipped code (`src/host/launcher/copy.ts`'s landed strings, this change's specs) as of
`store-launch-compliance` chain-7. §1-4 below are condensed into the uploadable
`release/store/app-store/review_information/notes.txt` (`platform-release-readiness` chain-11,
wired into fastlane's `ios metadata` lane); §5 points at the release files that hold the real
answers rather than restating them. If this file and either of those ever disagree, the committed
files win — update this doc to match, don't edit the console note ad hoc.

Reviewer contact: `<review contact: see ~/.config/whim/review-contact.json>`. This file is public;
no email address, phone number or person's name goes in it.

## 1. How to try Whim

No login, no account, nothing to sign in with. The home screen already has a few example apps on
it.

1. Tap `Describe an app…` (the composer row on Home).
2. The first time this happens on a fresh install, it opens the AI-data consent screen instead of
   the composer — that's expected, not a bug. Tap `Agree and continue` to proceed (`Not now`, or
   system back, returns to Home with nothing sent and the examples still fully usable).
3. Type a one-line description and tap `Continue`.
4. Answer (or skip) the one to three clarifying questions Whim asks, and tap `Continue`.
5. Review the plan and tap `Build it`. This takes about a minute; you can leave the screen and come
   back.
6. Tap `Open it` to run the app it made.
7. Inside the running app, the floating orb opens a menu with `Report this app` — the in-app
   reporting path 4.7.1 asks for.
8. Long-press an installed app's tile from Home and choose `App link` to see that app's universal
   link as selectable text.

## 2. Guideline 4.7

Whim's mini apps are plain HTML5/JavaScript, generated per user request and run inside a
same-process WebView. Three legs keep that sandboxed: the mini app's own document loads in an
opaque-origin iframe, the CSP served with it has no `unsafe-eval`, and the host neutralizes the
globals a bundle could otherwise reach out through. No network API — no `fetch`, `XMLHttpRequest`,
`WebSocket`, `EventSource`, `navigator.sendBeacon`, or WebSocket-adjacent primitive — is exposed to
mini-app code, and mini apps never see the host's own network stack.

**`[TODO — network-deny is not fully shipped yet]`** Those three legs stop a mini app from *calling*
out. They do not yet stop the sandboxed frame from navigating *itself* to an arbitrary URL as a
top-level navigation, which would still leave the device as a GET request. `platform-release-
readiness` (design D17) adds a native WebView policy that refuses that class of load; until it
merges, don't tell App Review "no data can leave the device from inside a mini app" — say what the
three shipped legs actually block, and update this paragraph (and delete this TODO) the day the
native leg lands.

- **4.7.1 (filtering, reporting, privacy).** The consent screen (`Before Whim makes apps for you`,
  copy.ts `consentTitle`) discloses what's sent and to whom before the first request goes out —
  see §4. The server checks a content-policy classifier — itself one small, bounded model call —
  before running the clarify, rewrite or generate model on every request; a request the classifier
  rejects comes back as a `content_policy` refusal, and the clarify/rewrite/generate model itself
  is never called (`service-refusals` spec, `REFUSAL_RULES` table) — filtering fails closed, not
  open. In-app reporting is live from three places: the orb menu (`Report this app`), the done
  step (`Report this app`), and each app's history header (`Report`). The response window on a
  filed report is `[BLANK — not yet decided; fill in before submission, do not publish a promise
  Whim can't keep]`. There's nothing to block, because there are no accounts, no sharing, and no
  way for one user to see another user's content.
- **4.7.2 (no native APIs without permission).** A mini app reaches the device only through ten
  local capability-bridge syscalls, all asynchronous and all confined to this app's own data:
  `storage.kv.get`/`.set`/`.remove`, `storage.records.append`/`.list`/`.update`/`.remove`,
  `diag.echo` (a round-trip test pipe, no side effect), `cues.haptic`, `cues.sound`. None of them
  touches the camera, microphone, location, contacts, the filesystem, or the network.
- **4.7.3 (no data or permissions to mini apps without consent).** A mini app only ever gets what
  the user typed into it and the data it saved through the storage syscalls above. It never
  receives the consent grant, the device ID, or any host credential.
- **4.7.4 (an index, with a universal link per app).** The home grid is that index. Every installed
  app's tile long-press menu carries `App link`, which shows the app's `https://whim.<domain>/a/…`
  link as selectable text.
- **4.7.5 (age limits for above-the-rating content).** Whim's own content carries no descriptors,
  but arbitrary user-driven generation gets a 13+ floor (see `release/store/app-store/
  age-rating.json`, `answers.md`), and the same server-side content policy that gates 4.7.1 stands
  between a prompt and a model call.

## 3. Guideline 2.5.2 context

Apple's guideline 2.5.2 bars an app from downloading or executing code that changes its own
features or functionality. Whim's mini apps don't do that: each one is plain HTML5/JS, rendered in
a WebView with the containment described in §2, and no mini app can add, remove, or alter anything
about the Whim app itself — no new screens, no new capabilities, no code that runs outside its own
sandboxed frame. What a mini app can do is exactly what 4.7 describes: a small, sandboxed,
reviewed-by-policy HTML5 app, indexed and linkable, that reads and writes its own data. `docs/
decisions.md` #64 has the fuller argument and the review history this rests on.

## 4. What leaves the phone, and when

Nothing leaves the phone from inside a running mini app — see the §2 TODO for the one gap still
open in that claim, and don't overstate it while that gap is open.

Two things leave the phone, both outside any mini app's own reach:

- **A generation request** (clarify, rewrite, or generate), sent only after the user grants AI-data
  consent on the screen described in §1. It carries what the user typed, their answers to Whim's
  questions, the approved plan, and — for a change to an existing app — that app's name, its code, its
  current description, and the shape of its saved data (never the rows saved inside it). An
  anonymous per-install device ID rides along for daily-limit enforcement. Declining consent, or
  never granting it, keeps every one of these off the wire; the examples and any already-installed
  app keep working either way.
- **A report**, sent only when the user fills in the report sheet and taps `Send report`. It's not
  gated on AI-data consent (a user who declined AI features can still report something) — see
  `docs/decisions.md`'s entry for D3 below.
- **A `GET /healthz` connectivity check**, sent only once AI-data consent is granted (and, once
  granted, when Settings' server field is saved), to show an online/offline status line. It carries
  no user content and no request body.

Nothing else: no analytics SDK, no crash reporter, no ads SDK, no background telemetry.

## 5. Store forms (draft — confirm every value in its own console before submitting)

Full drafts live as files, not repeated here, so there's exactly one place to edit each:

- **Apple App Privacy:** `release/store/app-store/app-privacy.json`.
- **Apple age rating:** `release/store/app-store/age-rating.json` (13+ via the override, every
  Whim-authored descriptor `NONE`).
- **Google Play Data safety:** `release/store/play/data-safety.json`.
- **The rest — AI-generated content declaration, content rating (IARC) answers, target audience,
  and the Device and Network Abuse exemption for JavaScript in a WebView:** `release/store/
  answers.md`.

Those files, plus `release/store/app-store/en-US/*` and `release/store/play/en-US/*` for the
listing text itself, are the source of truth `platform-release-readiness` uploads from. If
anything below disagrees with them, the files win; this section only orients a reviewer of this
document, it doesn't restate the values.

## 6. Pre-submission checklist

- [ ] `WHIM_DOMAIN` in the native release file (`release/whim-release.xcconfig`) matches
      `WHIM_DOMAIN` in `src/host/launcher/release-config.ts` — the domain-lockstep suite holds
      them together in the gate. The iOS associated-domains entitlement and the Android intent
      filter's `host` both derive from the native file automatically, so there's no third literal
      to check by hand.
- [ ] `/privacy` and `/support` are live at the real domain and the privacy page says what the
      consent screen says (§1, §4) plus report retention.
- [ ] Production `/healthz` answers on the real domain.
- [ ] The Google Play closed test track has at least 12 opted-in testers who have held the build
      for at least 14 days — required before this account can promote a release to production.
- [ ] After the first Play upload (App Signing assigns the Play signing key at that point, and
      `assetlinks.json` needs its fingerprint): verify `/.well-known/apple-app-site-association`
      and `/.well-known/assetlinks.json` are both live, correctly formed, and match the current
      Team ID / package name / signing fingerprints. Don't try to validate these before that
      upload — the Play signing key doesn't exist yet.
- [ ] `AI_CONSENT_VERSION` is bumped if the consent disclosure text changed since the last
      submission, and the hosted privacy policy was updated to match.
- [ ] Apple seller of record: AnyCognition Inc., Team ID `2B7K4YLS34`. Play developer account: a
      personal account, not an organization account — that's why the closed-test requirement above
      applies.
- [ ] Every store-form value in §5 has been confirmed inside its own console, not just in the
      committed file.

## Decision log

Design decisions D1, D2, D3, D6, D7, D10 and D16 (`openspec/changes/store-launch-compliance/
design.md`) are recorded in `docs/decisions.md`.
