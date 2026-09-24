# Stage demo, 2026-09-24 — start here

Whim presents at A TON of Demos (The Ottawa Network), Thursday 2026-09-24, The Prescott,
379 Preston St, Ottawa. Doors 6:00 PM, demos 6:30 PM, Whim is third of three. The slot is
15 minutes including Q&A, so about 10–11 minutes of talking and 3–5 of questions.

This folder is the source of truth for the demo. Any agent or session working on it reads
this file first, writes what it learned back here (or into the sibling files), and never
keeps a decision only in its own context. Files:

- `README.md` — constraints, decisions, open questions, log. This file.
- `run-of-show.md` — the minute-by-minute plan and the script for the parts that are scripted.
- `checklist.md` — prep by day, and the kit for the night.
- `formats.md` — alternative demo structures, competitor patterns, and how the ask collects feedback.
- `agent-prompt.md` — paste this into a fresh agent to bring it up to speed.

Related, older material: `docs/demo/storyboard.md` (the 2:30 hero film plan),
`demo/raw/PROGRESS.md` (August/September filming notes with real stage timings),
`demo/out/linkedin-2026-09-11-sound.mp4` (the finished cut with VO and music, the video backup).

## Constraints that shape the demo

- Davron presents alone; first demo ever. Rehearsal matters more than polish.
- Stage phone: Davron's iPhone 15 Plus (USB-C). The Android phone is
  old; it is not on stage.
- Laptop on stage: Jamila's 2018 Intel MacBook Pro. It cannot run a current macOS or iOS
  simulator. It only holds slides, the mirroring app, and the backup video.
- The venue is a bar with 6–7 TVs that all mirror one input, fed by a single cable. Some seats
  are far from the stage, so a phone held up in a hand reaches almost nobody. Whatever the room
  sees has to go through that one cable.
- Generation runs on the production server (`api.whim.anycognition.ca`). One generation per
  device at a time (`device_busy` otherwise). 15 generations per device per UTC day
  (`server/src/config.ts`, `WHIM_LIMIT_GENERATIONS_PER_DEVICE_DAY`); UTC midnight is 8 PM
  Ottawa time, so anything built after 8 PM Wednesday, Thursday morning's runs and the 6:30 PM
  demo all share one budget. Only builds count: clarify and plan writing have their own limits
  of 60 a day each. The owner can reset or raise the counter whenever needed, so the budget is
  a planning number, not a hard stage risk.
- A build can be left running: "Leave it running" puts a ghost tile on the grid and the run
  continues while other apps are opened; the tile turns real when it finishes. No push
  notification. A network drop ends the run in a failed state with Retry; nothing resumes.
- Backgrounding or locking the phone mid-build is unverified. Keep Whim in the foreground,
  auto-lock off.
- Voice is the OS keyboard's dictation, not an in-app feature. Say "I talk to it", don't claim
  built-in voice. Keep the prompt on the clipboard in case the room is too loud to dictate.
- The August timings (clarify ~70 s, plan ~68 s, build 150–220 s) are obsolete. Decision #69
  (PR #56, merged 2026-09-23) turned reasoning off for clarify and plan writing: ~2 s each on the
  bench, and engineer builds with thinking at a median of 87 s. Those are laptop-bench numbers
  against a local server; Wednesday's phone runs are the stage measurement.
- Store status on 2026-09-23: iOS 381237 on TestFlight internal (`Team` group; Davron invited,
  see `docs/handoff-2026-09-14.md` for the NOT_INVITED fix); Android 381237 on the Play alpha
  track, in review. No public TestFlight link yet (external `Public beta` group not created).

## Decisions

- Format (updated 2026-09-23): a cooking-show couch demo with two apps, a live-built hand
  tally and a pre-built cheat sheet whose History is the rollback demo. Plan in `run-of-show.md`.
  Originally: cooking show. Start a real generation in minute one, pitch over the wait, show a
  pre-built app plus History in the middle, come back to the finished app, then the ask.
  The organizer endorsed this on the vetting call.
- Rollback lives in the middle segment. It is the one thing nobody else in the room can show.
  In the UI it is History → expand a past version → **"Go back to this"** → confirm. It restores
  the same app in place with its data, and later versions stay listed for rolling forward
  (`openspec/specs/version-history/spec.md`). Not "Start a copy here": a copy gets its own
  fresh data and opens empty.
- Projection (changed 2026-09-23, pending the home TV test): the iPhone goes straight into the
  venue cable. Every iPhone 15 model outputs its screen over USB-C, so a USB-C to HDMI adapter
  mirrors it like a laptop would, with no app and no laptop in the chain
  (https://www.macrumors.com/2023/09/13/all-iphone-15-models-support-displayport/). Use an
  adapter with USB-C power pass-through so the phone charges while it presents (Apple's USB-C
  Digital AV Multiport Adapter is one). The portrait phone fills about a third of each
  landscape TV, so text size matters more than before. The 2018 MacBook only holds the backup
  video now; the fallback is unplugging the phone and plugging in the laptop. The Mac Mini relay
  idea is not needed.
- Slides (changed 2026-09-23): no deck. The pre-built cheat-sheet app is the deck: Davron's
  notes, in big type, on the TVs. The QR is an image in Photos. If the phone dies, the backup
  video on the laptop.
- Fallbacks, in order: (1) a copy of the demo app generated that morning, kept on the phone;
  (2) the backup video on the laptop; (3) slides only.
- The ask: join the beta. Play needs 12 opted-in testers for 14 days before production, so
  "I need twelve Android testers for two weeks, here's the QR" is specific and true. Give a
  TestFlight link for iPhone.
- Phone on cellular, not venue Wi-Fi. Do Not Disturb on, auto-lock off, full battery.

## Open questions

- Which prompt. Candidates from the corpus (`docs/app-corpus.md`) that are known to build and
  are interesting to watch: habit tracker (filmed in August), tea timer (filmed in September).
  Decide after the first flash-model runs; pick the one with the best success rate, not the
  coolest idea.
- Model: decision #69 keeps `deepseek/deepseek-v4.1-flash` as the engineer with thinking on;
  that is what `~/.config/whim/deploy.env` holds. The remaining stage lever is speed, not model:
  `WHIM_ENGINEER_REASONING=off` builds ~6x faster (median ~20 s) at ~2.6 points lower quality on
  the blind judge. Only for a rehearsed prompt, and only with a redeploy. Decide by Wednesday
  evening from the phone runs.
- If builds really take ~90 s end to end, the ghost tile turns real around 2:30–3:00, during the
  problem slide, not at 7:30. The run of show may need the pre-built app and History moved
  after the reveal, or the build started later. Retime after the phone runs.
- Is PR #56 deployed to production? `deploy.env` already has its knobs, but nothing records a
  deploy from `a9b03c4`. Tell from the first run: questions back in a few seconds means yes,
  ~30 s means no.
- What the finished-app tile looks like from across a room. Check readability of the mirrored
  phone on a TV; raise iOS text size for the day if needed.
- Amr's email says "MotivoAI". Confirm the listing says Whim.
- The ask doesn't work as a bare link yet. iPhone: the `Public beta` group and its link
  (https://testflight.apple.com/join/tM69UkDf) exist but only open once Beta App Review
  approves build 382511 (submitted 2026-09-23 midday). Android: the closed track uses the `Whim beta` email list, so a stranger scanning an
  opt-in link isn't let in until their Gmail is on the list. Whatever the QR opens has to
  collect an email (and can collect the feedback questions at the same time).
- Demo structure is open again (2026-09-23): Davron has doubts about the cooking-show format and
  is exploring alternatives; see `formats.md`.

## Log

- 2026-09-13: vetting call; format agreed (see `ton-of-demos` notes in the owner's memory).
- 2026-09-18: repo recon on generation survival, limits, failure states; findings folded into
  Constraints above.
- 2026-09-22: Apple API key + app record created; Android upload keystore created; this folder
  started.
- 2026-09-22, afternoon: PR 35 merged to main (`780923c`); backend deployed from that commit,
  smoke green. iOS build 381237 uploaded, processed and distributed to TestFlight internal
  testers; tagged `release/1.0.0+381237`. Android AAB 381237 built and verified
  (`~/Downloads/whim-1.0.0-381237.aab`), awaiting the hand upload to the alpha track. Play
  Console: all ten app-content declarations done (IARC came out Everyone/PEGI 3; target
  audience 13+), store listing text + icon + feature graphic saved as draft; phone screenshots
  in progress from the emulator. Signing needed an Admin-role App Store Connect key
  (`34LSB2S98U`); App Manager keys can't create the distribution certificate. Four latent
  release-tooling bugs fixed on branch `demo/stage-prep` (JDK detection, spaceship key hash,
  duplicate auth xcargs, binary privacy manifests). Next: screenshots → listing save → Play
  closed-testing release → Play signing fingerprint committed → phone on cellular, first
  generation (task 15.3).
- 2026-09-22, evening: Play alpha release 381237 rolled out to closed testing and all 15 console
  changes submitted for review (176 countries, China excluded; testers list `Whim beta`).
  Screenshots re-captured at 1080x2160 (release check caps 2:1). Play signing fingerprint
  committed; `deploy.sh --site-only` put both association files live (assetlinks 200, smoke
  green). All of it is on branch `demo/stage-prep`, draft PR #43. Still open: Davron's Apple ID
  in the TestFlight internal group, then the first generation from the phone on cellular.
- 2026-09-23, morning: PR #43 and PR #56 (faster generation, decision #69) merged to main at
  11:03. TestFlight NOT_INVITED fixed for Davron via the invitations API. Stage phone corrected:
  it is an iPhone 15 Plus (USB-C), not a 16 Pro Max. Constraints and open questions above
  updated for #69. TestFlight build confirmed installed on the 15 Plus. Two builds were made on
  the phone earlier today; their timings weren't written down. Paused the timed runs to rethink
  the demo format first.
- 2026-09-23, midday: iOS build 382511 (from `a9b03c4`, tagged `release/1.0.0+382511`) exists
  and is on the phone. Created the external TestFlight group `Public beta` (public link
  https://testflight.apple.com/join/tM69UkDf, no tester cap, feedback on) with 382511, filled
  in Test Information (beta description, feedback email, privacy URL, review contact from
  `~/.config/whim/review-contact.json`) and submitted 382511 for Beta App Review. The review
  notes are only the "HOW TO TRY WHIM" part of `release/store/app-store/review_information/notes.txt`;
  the rest of that file holds an internal TODO addressed to us, not to Apple. "What to Test"
  asks testers what they built, what they expected that it didn't do, and what they'd change
  first. Davron is cutting a newer build today; once 382511 passes, add the new one to `Public
  beta` (later builds of an approved version usually clear review quickly). Competitor demo
  research and eight candidate formats are in `formats.md`.
- 2026-09-23, afternoon: format B (room picks the app) rejected. Whim can't yet tell a user a
  request is impossible (a weather app needs the network), filed as issue #70. Every stage prompt
  is Davron's own, tested on the phone first. Privacy policy, store and review text is a
  placeholder another session is rewriting tonight; don't flag or rely on it here.

### Phone runs, 2026-09-23

Cellular, Whim in the foreground. Times are wall clock on the phone: questions = tap Continue
to questions shown; plan = submit answers to plan shown; build = tap Build to the tile turning
real. Budget left counts builds only.

| # | Time (EDT) | Prompt | Questions | Plan | Build | Outcome | Budget left |
|---|---|---|---|---|---|---|---|
