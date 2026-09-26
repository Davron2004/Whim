# Beta readiness, 2026-09-24 (after the TON demo)

What has to happen before the people who signed up at the demo get an invite, and how the 55 open
issues rank. Checked against production and the store APIs on 2026-09-24 ~22:00 EDT.

## State at the time of writing

- **Signups:** 3 in `waitlist.db` (2 iOS, 1 Android; one iOS row opted out of update emails).
  Log outcomes since the deploy: 3 `stored`, plus the smoke test's one `trap`. There were no `invalid`,
  `limited` or `error` outcomes, so nobody was turned away. The per-client limit was 200/h for the venue.
- **Data integrity:** `PRAGMA integrity_check` returns `ok` on `waitlist.db`, `usage.db` and `reports.db`.
  Server image `0fb65d51` is healthy (up 5 h). The logs show no errors, only Caddy's HTTP/2/3 notices
  and one aborted response at 20:35 UTC.
- **Demo night on the server:** every generation came from the demo phone. On 2026-09-24 there were
  23 generations delivered, 1 aborted and 0 failed. Clarify averaged 1.5 s and plan writing 2.4 s (#55's
  fix holds in production). No new user reports.
  Nobody from the audience has installed the app yet: they're on the waitlist.
- **TestFlight:** the external group `Public beta` exists with the public link on
  (`https://testflight.apple.com/join/tM69UkDf`). It holds build **382511** (commit `a9b03c47`, 2026-09-23),
  which is **Beta-App-Review approved**. Internal group `Team`: Davron and Jamila, builds 381237 and 382511.
- **Play:** closed testing (`alpha`) has 382511 released. The tester email list is managed in
  the console (list `Whim beta`), and the API can't read it.

## Can we add them as testers right now?

- **TestFlight "internal testers": no, and we shouldn't.** Internal testers have to be members of the App Store
  Connect team, so each one would be a person with a role on AnyCognition's developer team. External testing
  is the path for outside people. It is already set up and approved.
- **Don't upload iOS addresses to App Store Connect either** (#114). The privacy policy says iOS
  people get the TestFlight link by email, and Apple isn't a named recipient of their address. Email them the
  public link from support@whim.anycognition.ca.
- **Android:** paste the addresses into the Play closed-track list and email them the opt-in link
  (`docs/deploy.md` → Beta waitlist). Only closed testing counts toward Play's 12 testers × 14 days.
  Internal testing doesn't. With one Android signup the clock can't start yet, so Android needs 11 more
  people from other channels no matter what.
- **Mechanically, the iOS link could go out tonight. It shouldn't**, because the build behind it is 382511:
  - it predates legal-surface-v2: no terms step, v1 consent, while the v2 policy takes effect
    2026-09-27;
  - on iOS the composer's keyboard can't be dismissed and hides Continue (#50/#49), which blocks the core
    flow;
  - the orb covers the bottom of every generated app (#82).

## When to invite: after the beta-1 build, not before

The invite goes out with the first build that clears the list below. The sequence:

1. Land the **beta-1 change** (tier 0 below), then `gate-full`, the reviewer and closure.
2. Server-only items (tier 0 capacity, and tier 1's server items) deploy on their own. They don't wait for
   the app build.
3. Upload the iOS and Android builds. Check on a **newly created** simulator and a fresh emulator, including the
   upgrade from 382511/381237 (apps and data survive; #72). Then check the demo phone.
4. Add the build to `Public beta`. A new build of an already-approved version usually clears Beta App
   Review quickly, but it still needs the submission. Put the same build on the Play closed track.
5. Email the invites.

## Ranking

### Tier 0: blocks beta-1 (a tester would hit it in the first session)

| # | What | Why it's here |
|---|---|---|
| #100 | iOS age check never returns, AI features blank forever | Bricks the core product on iOS. The fix is a 3 s deadline that resolves `unavailable` |
| #50, #49 | Keyboard covers content app-wide; on iOS it can't be dismissed and hides Continue | Blocks the describe → questions → plan flow on iOS |
| #86 | Apple PermissionKit significant-change call | Required before v2 terms ship on iOS: wire it, or record why it doesn't apply |
| #88 | Render error after first paint leaves a blank mini-app, no recovery | Testers will generate buggy apps, and a blank screen with no way out reads as "Whim is broken" |
| #82 | Orb covers the bottom of every generated app | Visible in every app anyone builds |
| #104 | Consent screen shown twice from Settings, plus the 8.2(a) wording | Cheap, and it's the legal first impression |
| #101 | iOS stack traces carry the per-install folder UUID | Cheap, and it's an identifier we promised not to collect |
| #118 | Capacity: the 4th simultaneous generation gets `429 server_busy` | See "Chromium" below. The invite email lands in everyone's inbox at once |

### Tier 1: high leverage, in beta-1 if they fit, otherwise beta-2 within the week

- **Server-only, ship without an app build:**
  - #62 + the cheap half of #70: clarify must not offer what a mini-app can't do (notifications while closed,
    other devices, network), and should steer impossible asks (weather) to the nearest buildable thing.
    Demo audiences ask for exactly these.
  - #57: retry an engineer turn once when the provider drops mid-stream.
  - #58: log which check tripped on "couldn't verify this app ran safely" (about 2 % of benchmark builds).
  - #68: a quantization floor or provider order, so routing can't land on a 16 tok/s fp4 host.
- **App, cheap first-impression polish:** #48 (tile watermark clipping), #52's tile-colour collision only
  (not the example-set rethink), #105 (orb dim layer, grey disc), #89 (French digit grouping on a French
  phone).
- **Correctness to investigate:** #106 ("Change it" reported no changes but the stored source changed).
- **Process, not code:** #72. From now on every beta build gets an upgrade check (previous build → new
  build keeps apps, versions and data) before it ships. It passed once for 381237 → `main`.
- #66 (name provider outages, fail fast): beta-2. It only matters during an outage, but then it matters a lot.

### Tier 2: after testers are in

- #67: generated apps all look the same. This is the biggest product lever after beta-1: design direction in
  the plan, a richer token-based SDK, motion (the animation research). It needs a design and a "delight" judge.
- #52: the example-set rethink. #103 (iOS orb a11y), #102 (iOS errorClass), #83 (log line cap).
- #65: device attestation. It matters once the app is public; a closed beta doesn't need it.

### Not bugs

- **Release chores, done as part of shipping beta-1:** #37, #38, #39 (real-device and cellular checks),
  #42 (on-device app links). #46 is effectively done: the group, link and review exist. It only needs the
  beta-1 build added, then close it.
- **Only for the public store release, not the beta:** #36, #44, #45, #47.
- **Closeable:** #55. Production today shows clarify at 1.5 s and plan writing at 2.4 s; the demo phone was the
  on-device check.
- **Harness/tooling:** #59, #60, #61, #74, #79, #81, #87, #107.
- **Spec/doc hygiene:** #69, #92, #110, #111, #112, #113.
- **Waitlist:** #109 (sticky opt-out) must land before any email that isn't the beta invite itself. #114 is
  covered above. #115 only matters at scale.
- **Owner decisions:** #77 (Play account type vs EU), #78 (storefronts nobody researched).

## Chromium (#75): the premise is stale

Verified in code on 2026-09-24:

- The server launches **one** Chromium at boot (`server/src/lifecycle.ts:386` → `synthrun/session.ts:247`, "the
  only browser launch"). Each candidate run gets a fresh `BrowserContext` + page, which is closed when the run
  ends. The browser is relaunched only if it dies.
- Containment was designed around the **context**, not the process: OS-sandboxed Chromium, the opaque-origin
  iframe + CSP, egress blocked per context, nonce-authenticated verdicts
  (`openspec/changes/public-generation-server/design.md` D4/D5). So 100 users don't mean 100 Chromiums.
- Measured load test (`openspec/changes/public-generation-server/progress.md`, event profile, 2026-09-15): 15
  concurrent generations peaked at about 34 % of 8 vCPU and about 0.5 GB of a 16 GB limit. CPU is the constraint,
  not memory.
- **What actually happens at N users:** production runs the standard profile (`e2-standard-2`), whose defaults
  are `WHIM_MAX_CONCURRENT_GENERATIONS=5` and `WHIM_SYNTHRUN_CONCURRENCY=2`. The 6th simultaneous generation
  is **refused** with `429 server_busy`, not queued. At 100 simultaneous users, 95 get "busy". That's the
  engineering problem to fix:
  queue short waits instead of refusing, and raise the caps to what a load test on the real box supports.
  Memory has plenty of headroom, so the caps are probably far too conservative for 2 vCPU as well.
