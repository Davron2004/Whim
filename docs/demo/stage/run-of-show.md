# Run of show (draft 2, 2026-09-23 evening; retime after the TV test and phone runs)

Total 15:00. Target ~9:30 of talking, the rest for questions. Draft 1 (cooking show with slides)
is in git history.

## The two apps

- **Cheat sheet** (pre-built, on the grid): Davron's speaker notes, one note at a time in big
  type, Previous / Next, a way to add notes. It *is* the deck: the TVs show whatever the phone
  shows, and the notes are the talking points. Three versions in its History (see
  "Building the cheat sheet" below); the notes are its data and survive every version.
- **Hand tally** (built live): a few questions with a big + per question, used for the ask.
  Its build runs in the background from minute one while the cheat sheet carries the talk.
- Also on the grid, said out loud when it's seen: a copy of the hand tally built that morning
  ("one I made earlier, in case the demo gods hate me"). The example tiles stay. Nothing else.

## Where to start: options weighed

| Start on | For | Against |
|---|---|---|
| **Cheat sheet, note 1** (chosen) | The TVs show note 1 ("Say hi. You're Davron. Don't say um.") while he's introduced, so the room laughs before he speaks. The notes drive every step, including "go build something". Sets up the reveal at 2:45: the thing he's reading from was made by Whim. | One extra hop (cheat sheet → grid) before the build starts. The room doesn't know yet what it's looking at, which is the point. |
| Home grid | Obvious "this is the product" framing; the build starts sooner. | The first nervous seconds have no notes on screen. The grid spoils the cheat sheet (its tile is visible before the reveal). |
| QR / title image in Photos | The QR is up while people settle. | An extra app switch, and the QR comes back at the ask anyway. Keep it for the ask. |
| Build already started before walking on | No live-build risk in minute one. | Throws away the "it's real, watch" moment the format rests on. |

## Minute by minute

Superseded 2026-09-24 by `script.md` (open on the home grid, no reveal, a Q&A timer built live instead of the hand tally).

Each row: what's on the TVs → what he does. The note text is a draft (see "Cheat sheet notes").

| Clock | TVs show | What happens |
|---|---|---|
| before | Cheat sheet, note 1 | Phone plugged in and mirroring while he's introduced. |
| 0:00 | note 1 | "Hi, I'm Davron…" One sentence on who he is. Next. |
| 0:30 | note 2 → grid → compose | "My notes say build something live, so." Leave the cheat sheet, grid, Describe an app, the hand-tally prompt (dictate or paste), Continue. |
| 0:50 | clarify → plan | Answer the questions out loud, short. The plan appears in ~2 s: skim one line, Build it, **Leave it running**. The ghost tile is on the grid. |
| 1:45 | cheat sheet, note 3 | Back into the cheat sheet. What Whim is: describe an app, it builds it, it lives on your phone. |
| 2:45 | note 4 | The reveal: "This, what I'm reading from, is a Whim app. I made it last night because I forget what I want to say." |
| 3:15 | grid → History | Long-press the cheat sheet → History. Three versions, each with the prompt that made it. Expand v1 → **Go back to this** → confirm. |
| 4:00 | cheat sheet v1 | Open it: ugly, no + buttons, **every note still there**. Read the next note from the ugly version. |
| 4:45 | History → v3 | History → v3 → Go back to this. Open it: pretty again. Tap + and add one note live to prove it works. |
| 5:45 | note: safety/difference | How it's different, one or two sentences. |
| 6:45 | grid → hand tally | "Let's see if my other app is done." The tile is real → open it. (Still building: go back to the notes and do the next one first; the order is flexible. Failed: open the morning copy.) |
| 7:00 | hand tally | The questions; hands up; tap the counts in. The room builds the result with him. |
| 8:30 | QR (Photos) | The ask: download it, try it, tell me what you'd build. The QR stays up. |
| 9:30 | last note | "Questions." |

## Building the cheat sheet (today and tomorrow morning)

Three builds on the same app (Prompt again), each checked before the next. Verify after every
one that all the notes are still there. That is the whole demo.

- **v1, today, before the first run-through, deliberately plain:** one note at a time in large
  text, Previous and Next, "note 3 of 11", a box to add a note at the end. Say in the prompt that
  each note is saved with its position number and the app remembers which note it's on. v3
  needs the order and v1 must already store it, or going back to v1 scrambles the order. Type
  the real notes into v1 and use it in every rehearsal.
- **v2:** add a + before and after the current note to insert one there.
- **v3, Thursday morning at the latest:** made for a big TV. Bold huge type, a slide animation
  between notes, progress dots.
- Then rehearse the round trip once: Go back to v1 (the + disappears, notes intact, order
  intact) and forward to v3. Watch the confirm sheet's wording for "your data is kept".
- If a version loses or reorders notes, re-run that Prompt again. Don't go on stage on a
  version that failed this check.

## Cheat sheet notes (draft, a little humour; Davron edits)

1. Say hi. You're Davron. Don't say um.
2. Build something live. Now, before you chicken out.
3. While it builds: what is Whim?
4. Reveal: you're reading this off a Whim app.
5. Show History. Make it ugly on purpose.
6. It's ugly. The notes are all still here. Point that out.
7. Make it pretty again. Add a note to prove the + works.
8. Why it's different (one sentence, don't ramble).
9. Check on the tally app. Pray.
10. Count hands.
11. The ask: download, try, tell me what you'd build.
12. Questions. Breathe.

## Hand tally

The prompt carries the questions, so nothing gets typed on stage. Draft, test on the phone:

> A hand-count tally for a live audience. Three questions, each with a big plus button, a small
> minus to fix mistakes, and the count in huge numbers: "Who has an idea for a tiny app they'd
> never build themselves?", "Who's on Android?", "Who'd try Whim this week?"

It's long to dictate in a bar. Rehearsal decides dictate vs paste ("it's loud in here, I'll
paste it").

## Scripted parts

The first 60 seconds and the ask, word for word, once the notes above are settled. Everything
else follows the notes.

## Questions to have answers for

- "How do you secure it?" Generated code runs in a sandboxed WebView with no network, no eval,
  and a closed bridge; the host app decides what it can touch. Then offer to go deeper after.
- "Why not just use Replit / Lovable?" They build web apps you deploy somewhere. Whim builds
  things that live on your phone, next to your data, in a minute, with no account.
- "How do you make money?" Not the point yet; it's a learning ground first. Say that plainly.
- "What model?" Small coder models through OpenRouter, chosen by an eval on a corpus of
  small apps, not by feel.
- "Can it build a weather app?" (or anything else that needs live data). No: mini-apps have no
  network, and today Whim doesn't say so up front; it tries anyway (issue #70). Say that plainly
  and turn it into the ask: this is exactly the kind of thing I need you to tell me about.
- "What can't it build?" Anything that needs the network, the camera, or your contacts, by
  design. Say what that buys: nothing generated can leak anything.
