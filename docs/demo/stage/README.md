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
- `agent-prompt.md` — paste this into a fresh agent to bring it up to speed.

Related, older material: `docs/demo/storyboard.md` (the 2:30 hero film plan),
`demo/raw/PROGRESS.md` (August/September filming notes with real stage timings),
`demo/out/linkedin-2026-09-11-sound.mp4` (the finished cut with VO and music, the video backup).

## Constraints that shape the demo

- Davron presents alone; first demo ever. Rehearsal matters more than polish.
- Stage phone: Davron's iPhone 16 Pro Max (paired with the build Mac). The Android phone is
  old; it is not on stage.
- Laptop on stage: Jamila's 2018 Intel MacBook Pro. It cannot run a current macOS or iOS
  simulator. It only holds slides, the mirroring app, and the backup video.
- Venue has TVs, cables, sound. Bring a USB-C to HDMI adapter anyway.
- Generation runs on the production server (`api.whim.anycognition.ca`). One generation per
  device at a time (`device_busy` otherwise). 15 generations per device per UTC day
  (`server/src/config.ts`, `WHIM_LIMIT_GENERATIONS_PER_DEVICE_DAY`); UTC midnight is 8 PM
  Ottawa time, so Thursday-morning runs and the 6:30 PM demo share one budget.
- A build can be left running: "Leave it running" puts a ghost tile on the grid and the run
  continues while other apps are opened; the tile turns real when it finishes. No push
  notification. A network drop ends the run in a failed state with Retry; nothing resumes.
- Backgrounding or locking the phone mid-build is unverified. Keep Whim in the foreground,
  auto-lock off.
- Voice is the OS keyboard's dictation, not an in-app feature. Say "I talk to it", don't claim
  built-in voice. Keep the prompt on the clipboard in case the room is too loud to dictate.
- Timings measured so far come from the old model (August: clarify ~70 s, plan ~68 s, build
  150–220 s; ~6 min end to end). Nobody has measured the flash model from a phone yet. The
  rehearsal runs are that measurement.
- Store status on 2026-09-22: Apple app record and API key exist; Play app exists with the
  console forms in progress; first uploads pending the PR 35 merge and deploy.

## Decisions

- Format: cooking show. Start a real generation in minute one, pitch over the wait, show a
  pre-built app plus History in the middle, come back to the finished app, then the ask.
  The organizer endorsed this on the vetting call.
- Rollback lives in the middle segment. It is the one thing nobody else in the room can show.
  In the UI it is History → "Start a copy here" → "Make the copy"; say "I can go back to any
  version and branch from it".
- Projection: phone mirrored to the laptop over USB (QuickTime, New Movie Recording, iPhone as
  camera), laptop to HDMI. One screen for slides and phone, no cable swapping mid-talk.
- Slides: about five (who I am, the problem, what Whim is, how it differs, the ask). One holds
  the security answer. They carry the pitch while the build runs and are the fallback if the
  phone dies.
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
- Does the flash model hold up from a phone? If the check stage fails repeatedly, flip
  `WHIM_ENGINEER_MODEL` back to `deepseek/deepseek-v4-pro-0813` in `~/.config/whim/deploy.env`
  and redeploy. Decide by Wednesday evening.
- What the finished-app tile looks like from across a room. Check readability of the mirrored
  phone on a TV; raise iOS text size for the day if needed.
- Amr's email says "MotivoAI". Confirm the listing says Whim.

## Log

- 2026-09-13: vetting call; format agreed (see `ton-of-demos` notes in the owner's memory).
- 2026-09-18: repo recon on generation survival, limits, failure states; findings folded into
  Constraints above.
- 2026-09-22: Apple API key + app record created; Android upload keystore created; this folder
  started. Next: merge PR 35, deploy, first TestFlight + Play uploads, first phone generation.
