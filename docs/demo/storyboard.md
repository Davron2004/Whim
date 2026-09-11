# Whim demo — hero film storyboard

**Purpose:** one master capture set → three cuts. Priority order: hero film (~2:30, collaborators) → LinkedIn teaser (45–60s, muted-first) → portfolio/README embeds (8–15s loops).

## Format decisions

| Decision | Choice | Why |
|---|---|---|
| Aspect | Portrait masters, framed on dark 16:9 canvas | Desktop letterboxed focus; masters crop cleanly for teaser later |
| Capture | Emulator via `scrcpy --record`, native res, 60fps | Clean frames, no window chrome; speed-ups stay smooth |
| Audio | VO recorded last after picture lock; music bed ducked −12dB | Script defines cuts, not vice versa |
| Captions | None in hero film; burned-in only in teaser | |

## Storyboard

| # | Time | Visual | Edit notes |
|---|---|---|---|
| 1 | 0:00–0:14 | Cold open: grid + orb tap, prompt typed in | Real-time; title card late: **Whim — describe it. It exists.** |
| 2 | 0:14–0:38 | Clarify question → answer → plan rows → inline-edit one row → Build | Real-time, tight; no dead air |
| 3 | 0:38–0:58 | Ghost tile waits → **transmutes** into colored tile | 3–4× speed-up, then REAL TIME ~3s before transmute — untouched |
| 4 | 0:58–1:24 | App v1: check-off → nav → calendar heatmap → back-exit → reopen → data persists | Reopen = persistence flex, keep it |
| 5 | 1:24–1:46 | Second prompt "add streaks" → sped-up build → streak UI | Same grammar as #3 |
| 6 | 1:46–2:06 | Version history: scroll summaries, filter pills, tap-expand | Real-time; give it air |
| 7 | 2:06–2:22 | Fork behind confirm sheet → new tile → side-by-side divergence | Money shot; real-time, no internal cuts |
| 8 | 2:22–2:30 | Zoom out: launcher grid, several apps built this session | |
| 9 | 2:30 | End card: name · React Native · hardened WebView sandbox · LLM pipeline · contact | Hold 4s, silent |

## Narration script (~140 words)

> **[1]** Watch — I'm going to build an app by asking for one. A habit tracker.
>
> **[2]** It asks one clarifying question. Then drafts a plan — editable before anything exists.
>
> **[3]** While it builds, the tile waits right here. Done — and it lands. No install. No store.
>
> **[4]** A real app: screens, charts, storage that survives a restart. And sandboxed — every app sees only its own data.
>
> **[5]** Now the point of all this: "add streaks." Same app. New generation. Nothing lost.
>
> **[6]** Every change becomes a version, summarized in plain language. Browse it like history — filter it, expand any row.
>
> **[7]** Any version forks into its own lineage. Separate histories, separate data. The original never notices.
>
> **[8–9]** Whim. Describe the app you want. Keep going until it's the one you meant.

## Master capture checklist (all before editing)

1. Grid + orb tap + compose entry *(3+ takes)*
2. Clarify exchange
3. Plan preview + one-row edit
4. Build wait + transmute — long real-time takes, **3+ tries**
5. App v1 walkthrough: check-off, nav, heatmap
6. Kill + reopen persistence proof
7. "Add streaks" rewrite + result
8. Version history: scroll, filter, expand
9. Restore flow incl. confirm sheet (B-roll, optional beat)
10. Fork: sheet → tile → side-by-side (**3+ tries**)
11. Closing grid pan, 4–6 installed apps

## Production rules (emulator)

- Build: `npm run android:release` offline release (Metro NAT route is dead); Node 22 verified (`node -v`)
- Record with `scrcpy --record <file> --no-audio` at native emulator resolution; frameless emulator window, device frame off
- DND/notifications cleared; consistent emulator window size across takes
- Seed tracker with ~a week of realistic data before take one so charts aren't empty
- Live generation server confirmed working before shot 1; token metering topped up
- Raw takes only — never delete; edits are cheap, retakes aren't
- Layout: `demo/raw/<shot#>-<slug>/take-N.mp4`

## Free derivatives (same captures)

- **Teaser:** shots 1→3→5→7 + end card, burned captions, muted-first
- **Embeds:** transmute · plan-edit · heatmap · filter+expand · fork divergence

---

## Appendix B — Handoff prompt (paste into another AI)

You are producing the raw footage for a product demo of **Whim**, an Android launcher where users create mini-apps by describing them. Everything runs locally: an RN host app (offline release build, no Metro needed), a local generation server, apps rendered in a sandboxed WebView.

Setup: Node 22 (`node -v` must confirm), then `npm run android:release`. Boot one emulator (device frame OFF, fixed window size). Install the release APK if not auto-installed. Confirm the generation server responds before filming anything.

Your only job: produce the master capture set in `demo/raw/`, following `docs/demo/storyboard.md` — the checklist section lists shots 1–11, the rules section lists framing/settings. Each shot = its own directory with numbered takes. Shots 1, 4, 10 get 3+ takes minimum; shots 4 and 10 contain one-shot moments (tile transmute, fork divergence) — record LONG takes and verify each contains a clean uncut moment before moving on.

Rules: 60fps screen recording (`scrcpy --record --no-audio`), notifications cleared, seeded habit-tracker data (~a week) so charts render, no narration during capture, never delete takes. Do NOT attempt editing, VO, or cutting — raw masters only.

Verify before finishing: every checklist item has ≥1 usable take; every take starts ≥2s before action and ends ≥2s after; filenames follow `<shot#>-<slug>/take-N.mp4`. Report a table of shots × takes with pass/fail per usability criterion.
