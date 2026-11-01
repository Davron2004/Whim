# Beta-2 owner steps (Davron / Jamila)

Written 2026-10-31 by the beta-2 release orchestrator. These are the steps no agent can take: a
physical phone, an inbox, a password manager, or a console prompt that needs the account owner. Work
top to bottom; each step says where to click and what to type. Status and build numbers are in
`docs/release/beta-2-release-status.md`.

## 1. Back up the release keys today (5 minutes, blocks nothing but protects everything)

The 2026-10-10 wipe deleted every release credential under `~/.config/whim/`, including the Android
upload keystore, with no backup. They were recreated on 2026-10-31. Put these in the password manager
(1Password / iCloud Keychain secure note), as files, not pasted text:

- `~/.config/whim/whim-upload.jks` (Android upload key, alias `whim-upload`) and the two
  `WHIM_UPLOAD_*_PASSWORD` lines from `~/.gradle/gradle.properties` (both are the same value).
- `~/.config/whim/play-publisher.json` (Play API key; replaceable with
  `gcloud iam service-accounts keys create`, but saves a step).
- `~/.config/whim/AuthKey_<id>.p8` and `~/.config/whim/asc-api-key.json` (App Store Connect API key;
  Apple never offers the `.p8` download again).

Then revoke what was lost (nobody holds those keys any more, so this only removes dead credentials):

- GCP: `CLOUDSDK_CORE_ACCOUNT=j.ruzimetova@gmail.com gcloud iam service-accounts keys delete 61a1fb4bd43078f4b3dd17655a9772f780fc3c4d --iam-account play-publisher@anycognition-whim.iam.gserviceaccount.com --project anycognition-whim`
- App Store Connect → Users and Access → Integrations → App Store Connect API → Team Keys: revoke
  `whim-release-admin` (34LSB2S98U); keep `Whim release 2026-10-31` (4V4UN8R5H9).

## 2. Android closed testing: open the tester door (starts Play's 14-day clock)

Play's production-access rule for a personal account: **12+ testers opted in for 14 days in a row**
on a closed track with a live release. The track is ready: **Closed testing - Alpha** (live release
382511 since 2026-09-23, 177 countries). The clock is waiting only on opted-in testers, so this step
is the critical path; it does not need the beta-2 build.

Opt-in link (what testers open): **https://play.google.com/apps/testing/com.anycognition.whim**

Pick ONE way testers get onto the track (Play allows email lists OR Google Groups on a track, not
both):

- **A. Google Group (recommended: people add themselves, no address pasting).** The agent filled the
  form but Google demanded a captcha. In ego-browser (space "whim console lane", tab "My groups"),
  tick "I'm not a robot" and click **Create group**. If the dialog is gone:
  https://groups.google.com/u/3/my-groups → Create group → Name `Whim beta testers`, email
  `whim-beta-testers` → Next → Who can search: Anyone on the web; Who can join: Anyone can join;
  View conversations: Group managers; Who can post: Group owners; View members: Group managers →
  Next → no members → Create group → captcha.
  Then Play Console → Closed testing - Alpha → Testers tab
  (https://play.google.com/console/u/3/developers/7409536398802011901/app/4972827149871085117/tracks/4698714471867230200?tab=testers)
  → select **Google Groups** → type `whim-beta-testers@googlegroups.com` → Enter. In the same save,
  change "Feedback URL or email" from `support@anycognition.ca` to `support@whim.anycognition.ca`.
  Save; if Publishing overview shows "Send changes for review", send them. Join the group yourself
  with both accounts (the "Whim beta" email list drops off the track when you switch).
  Testers: join https://groups.google.com/g/whim-beta-testers, then open the opt-in link.
- **B. Email list (the runbook's way, `docs/deploy.md` "Beta waitlist").** Keep the existing list
  "Whim beta" (Davron + Jamila) and paste the waitlist's Android addresses into it:
  `node server/waitlist.mjs export --platform android` against production (see `docs/deploy.md`),
  keep the email column, Play Console → the same Testers tab → "Whim beta" → add addresses → Save.
  Only fix the feedback email as above.

Then send the invitations yourself per `docs/deploy.md` "Sending beta emails" (Zoho support
mailbox, BCC only, identification footer + stop line). The waitlist alone (5 rows at the opt-in
migration) cannot reach 12; recruit friends/family with Android phones who will **stay opted in
for 14 days** (installing is not required for the count, opting in is; uninstalling is fine, leaving
the test is not). Check the count in Play Console → Closed testing - Alpha → Testers ("opted in").

## 3. Android beta-2 build: nothing to do until 2026-11-03

The old upload key was lost, so an upload-key reset was requested on 2026-10-31. Play: "The new
upload key will become valid on **Nov 2, 2026 at 11:59 PM UTC**. Until then you can't upload any new
app bundles or APKs." The beta-2 AAB is already built and signed with the new key (see the status
doc); an agent uploads it after that time. Meanwhile testers who opt in get 382511 (beta-0). That
build predates the protocol header, so today's server answers it `426` ("update needed"): opting in
still counts toward the 14 days, but tell early testers the working build arrives about Nov 3.

## 4. TestFlight public beta

The external group **Public beta** exists with its public link on:
**https://testflight.apple.com/join/tM69UkDf** (no tester limit). Test Information now says
feedback `support@whim.anycognition.ca`, marketing `https://whim.anycognition.ca`, privacy
`https://whim.anycognition.ca/privacy`; the Beta App Review contact is Davron
(+1 613 862 9687, davron.jabborov@gmail.com). Until Apple approves the beta-2 build, link testers get
382511, which today's server refuses with `426` ("update needed"); send the link only after approval.

- Watch for Apple's Beta App Review email for the beta-2 build (usually within 24–48 hours). If
  Apple asks a question, answer it in App Store Connect → TestFlight → the build → Review (the
  answers are yours, not an agent's).
- Once approved, email the public link per `docs/deploy.md` "Sending beta emails" (iOS: link only,
  never upload addresses to App Store Connect).
- Put the link on the demo's last slide / beta QR (`docs/demo/stage/`, #46).

## 5. On your own phones (the agents may not use physical devices)

Use the beta-2 store builds: TestFlight build 437758 (1.1.0) on the iPhone once Apple approves it,
and the Play closed-testing build 437758 on the Android phone once it is live (after Nov 3). Before
anything else, delete older Whim installs.

1. **Device checklist:** `docs/release/owner-device-checklist.md`, sections 1–8, on both phones.
   Report anything off with a screenshot (a GitHub issue per defect).
2. **Cellular generation (#39):** Wi-Fi off. Build one app (e.g. "a water tracker") and open it.
   Start a second build and cancel it mid-way. Note the time of each and the build number shown in
   Settings; an agent then reconciles the server ledger and the provider cost for those two requests
   (paste the times into #39). Prompts and report text stay out of the issue.
3. **App links (#42), after the site is redeployed with the corrected fingerprint (see the status
   doc).** Links look like `https://whim.anycognition.ca/a/<app id>`; use the id of an app on that
   phone.
   - iPhone: paste such a link into Notes, tap it with Whim closed (cold), then again with Whim in
     the background (warm). Both must open that app inside Whim, not Safari.
   - Android (USB debugging on): `adb shell pm verify-app-links --re-verify com.anycognition.whim`,
     wait 30 s, `adb shell pm get-app-links com.anycognition.whim` must say
     `whim.anycognition.ca: verified`; then
     `adb shell am start -a android.intent.action.VIEW -d https://whim.anycognition.ca/a/<app id>`
     must open the app in Whim. Paste the outputs into #42.
4. **Themed icon (#38, last open item):** on any Pixel (or a phone whose launcher supports Material
   You themed icons), Settings → Wallpaper & style → Themed icons on; the Whim flame must render as
   a single-colour themed icon. A screenshot in #38 closes it.
