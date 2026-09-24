# Stage script (draft 6, 2026-09-24): the simulated run

Every beat of the talk: the clock, what the TVs show, what Davron's thumb does, and whether he's
speaking or silent. Words in "quotes" after **Say** are his, word for word. UI labels in
"quotes" are verbatim from the app (`src/host/launcher/copy.ts`, checked 2026-09-24 against the
commit the phone build came from). Lines in [brackets] are filled in on the night.

Replaces draft 4 and the minute table in `run-of-show.md`. Still valid there: "Building the
cheat sheet" and "Questions to have answers for". How this draft was reached, and what only a
phone rehearsal can settle, is at the bottom.

The room is mostly sales and marketing people, with some engineers. Every line has to make sense
to someone who has never written code; the engineers get their part in the open-source beat and
in Q&A.

About 950 spoken words over 8½ minutes, then a 4-minute Q&A on the timer, ending near 12:40 in a
15-minute slot.

## Two screens, one swipe apart

- **The title slide**, a video in Photos: Whim's indigo, the rounded W, slow calm motion, the QR
  in the top-right corner with "Try the beta". Landscape, so it fills the TVs. It carries the
  opening and comes back for the ask.
- **Whim**, portrait, for everything in between.

Switching is a swipe along the bottom edge of the phone. The TVs jump between landscape and
portrait when it happens; that's fine.

## Before walking on

- Open Photos on the title slide video, then switch to Whim, then back to Photos, so Whim is one
  swipe away. The talk starts on the title slide.
- The timer prompt is on the clipboard. Copy nothing after it.
- Whim is on its home grid underneath. Do Not Disturb on, auto-lock off, rotation lock off,
  phone in the adapter, TVs mirroring.
- The spare timer's list is cleared (Reset), so it shows no rehearsal data if it's needed.

## 0:00–1:45 · Who, what, why · SPEAKING, from memory

**TVs:** the title slide, playing. The QR is up from the first second, so early scanners scan.
**Thumb:** nothing.

**Say:** "Hi, I'm Davron. I'm a software developer, and a math and CS student at U of T, on leave
right now.

This is Whim. It's an app on your phone that makes other apps. You tell it what you want, in
plain words, it asks you a couple of questions, and about a minute later the app is on your phone
and you're using it. You never see code, and nothing goes through an app store. People call this
vibe coding: you describe software and AI writes it.

Here's why I built it. A lot of the time I know exactly what would help me: a small piece of
software, with a particular screen, for one particular thing, right now. Something I'll use once,
or for a week. And AI can write small throwaway apps like that easily now. The code was never
the problem. The problem is everything around it: a project, a build, getting it installed on
your phone. That's a lot of ceremony for something you'll use once. So I wanted to get rid of the
ceremony. When you need a little piece of software, you ask for it, and it's on your phone.

This is my first demo ever, so be nice. Let me show you."

## 1:45–2:00 · Start a build · SPEAKING, from memory

**Thumb:** swipe to Whim, turn the phone upright. **TVs:** the home grid. "Whim", "Your apps",
the tiles, "Describe an app…" along the bottom.

**Say:** "At the end I'll take your questions, and I ramble, so I want something that keeps me
honest. Let's build a Q&A timer."

**Thumb:** tap "Describe an app…". **TVs:** "What should it do?", the keyboard up.

## 2:00–2:10 · The prompt · SPEAKING

**Thumb:** long-press the field, Paste. The prompt fills the field.

**Say:** "I'm asking for a four-minute countdown, a button I press every time I finish an
answer, and stats on how long I take."

**Thumb:** "Continue". The button reads "One moment" for about 2 seconds.
**SILENT** for those 2 seconds. Don't fill them.

## 2:10–2:35 · Clarify · SPEAKING

**TVs:** "Two quick things" (or One or Three), each question a row of pills.

**Say:** "Before it builds anything, it asks me a couple of things, the way a person would."
Then each question and your pick, out loud as you tap: "[Question]? [Answer]."

If it goes straight to the plan instead: "It didn't need to ask me anything this time."

**Thumb:** "Continue". **SILENT** for the ~2 second "One moment".

## 2:35–2:55 · The plan · SPEAKING

**TVs:** "Here's the plan", "Tap anything to change it before building."

**Say:** "Then it writes a plan in plain English. I could tap any line and change it. I won't,
because I trust it, and because I have ten minutes."

**Thumb:** "Build it".

## 2:55–3:10 · Building · SPEAKING

**TVs:** "Making it", "This takes about a minute. You can leave and come back.", four steps
ticking over ("Reading your plan", "Writing the app"…).

**Say:** "Now it's writing the app. It says about a minute, and I'm not going to make you watch
a progress bar."

**Thumb:** "Leave it running". **TVs:** the grid, with a grey tile captioned "Building…".

**Say:** "That grey tile is the timer, still cooking. We'll come back to it."

## 3:10–3:50 · Cheat sheet, note 1 · SPEAKING

**Thumb:** tap the cheat sheet tile. A second of loading (**SILENT**).
**TVs:** note 1, "Hi. These are my notes. Yes, you can read them."

**Say:** "While that cooks, here's an app I made with Whim this week. These are my speaker notes.
I lose my train of thought when I'm nervous, so I asked Whim for a notes app that shows one note
at a time, in big letters. So yes, you get to read my notes. There's nothing embarrassing in
there. Probably."

**Thumb:** Next.

## 3:50–4:30 · Note 2, "Is it safe?" · SPEAKING

**Say:** "You might be wondering if it's safe to run an app that AI wrote, on your phone. So
every app Whim makes runs locked in a box. It can't go on the internet, it can't see your
contacts or your camera, and it can't read what's in your other apps. That means Whim can't make
some apps, like one that shows the weather. I made that trade on purpose, because it means
nothing Whim makes can leak your stuff."

**Thumb:** Next.

## 4:30–5:05 · Note 3, "This app didn't always look like this." · SPEAKING while tapping

**Say:** "This notes app didn't start out looking like this. Every time I asked Whim for a
change, it kept the version before. Let me show you."

**Thumb:** the orb (bottom-right), "Versions".
**TVs:** the cheat sheet's history, "3 versions", one row per version, each with "You said" and
what was asked.

**Say:** "Here's its history. Three versions, and each one shows what I asked for. This is the
first. Let's go back to it."

**Thumb:** tap the v1 row (it expands), then "Go back to this".
**TVs:** the sheet "Go back to v1?", "…Your saved data stays. You can come forward again from
this list."

**Say:** "It checks first. And read the middle of that: your saved data stays."

**Thumb:** "Go back to it" (the small plain button; the big one is Cancel). Toast: "You're on v1
now". Leave History for the grid.

**TVs:** the grid. The timer's grey tile should be a real tile by now.
**Say**, if it is: "Oh, and my timer's done. Later." If it still says "Building…", say nothing.
If it has a red border and "Didn't finish", say nothing either: you now know to open the spare
at the end, so that moment holds no surprise.

**Thumb:** tap the cheat sheet tile.

## 5:05–5:30 · Version 1 · SPEAKING, one silence

**TVs:** the cheat sheet v1: plain, small, no + buttons, on note 3.

**Say:** "This is version one. It's ugly."
**SILENT** for two seconds. Let them laugh.
**Say:** "But all my notes are still here, in the same order. Changing the app never touched the
notes in it."

**Thumb:** Next. **TVs:** note 4, "Ugly. But every note survived.", in v1's styling.

**Say:** "Okay, I can't present from this. Back to the good one."

## 5:30–5:55 · Forward to v3 · SPEAKING while tapping

**Thumb:** orb, "Versions", tap the v3 row, "Go back to this", "Go back to it". Toast: "You're
on v3 now". Leave History, tap the cheat sheet tile.

**Say**, over the taps: "Going back didn't delete anything. The newer versions stay in the list,
so I can come forward the same way."

**TVs:** the cheat sheet v3 on note 4.
**Say:** "And it's back, on the same note."

**Thumb:** Next.

## 5:55–6:35 · Note 5, "Why not Replit or Lovable?" · SPEAKING

**Say:** "People ask me how this is different from Replit, Lovable or Base44. Honestly, we're
solving the same problem: you describe software and AI builds it. We go about it differently.
Those tools help you build something to publish, for other people. Whim is for software you make
for yourself, for one job. It lives on your phone, what you put in it stays on your phone, and
every app is locked in that box. If you like that way better, try Whim."

**Thumb:** Next.

## 6:35–7:15 · Note 6, "It's open source." · SPEAKING

**Say:** "And Whim is open source. All of it is on GitHub, so anyone can check what it does. If
you're a developer, open an issue, or send me a pull request, and I might even merge it. You can
also run the server yourself: the app has a setting for your own server address, and then how
Whim builds apps is yours to change. If you're not a developer, every Whim app has a Report
button, and those reach me."

**Thumb:** Next.

## 7:05–8:05 · Note 7, "Now, what I need from you." · SPEAKING, then SILENT

**Thumb:** swipe to Photos, turn the phone sideways. **TVs:** the title slide, QR top-right.

**Say:** "Whim is in beta on iPhone and Android. Scan this, and it tells you how to get it. And
tell me one app you'd build. Android people: Google won't let me launch until twelve testers use
it for two weeks, so I really do need you. Take a photo of it."

**SILENT** for about five seconds, QR held, while the phones come up.

## 8:05–8:25 · The timer · SPEAKING

**Thumb:** swipe back to Whim (it lands on the cheat sheet), turn the phone upright, orb,
"Home", tap the new timer tile.

**Say:** "And now the timer I built at the start."

If its tile has a red border and "Didn't finish": "That one didn't make it. It happens. So I made
a spare this morning, in case the demo gods hate me." Tap the spare.

**TVs:** the timer at 4:00.
**Say:** "You've got four minutes. Every time I finish an answer I press this, and we'll see how
badly I ramble."

**Thumb:** Start.

## 8:25–12:25 · Q&A · on the timer

**TVs:** the countdown, the Answered count and the stats updating.
**Thumb:** "Answered" after each answer. Answers for the likely questions: `run-of-show.md`,
"Questions to have answers for".

When "Time's up" shows, finish the sentence you're in, then:

**Say:** "[N] questions, [X] seconds on average, and the longest was [Y]. [To whoever asked it:]
That one was you. If you took a photo of the QR, I want to hear what you build. Thank you."

## Cheat-sheet notes (type these into the app)

1. Hi. These are my notes. Yes, you can read them.
2. Is it safe?
3. This app didn't always look like this.
4. Ugly. But every note survived.
5. Why not Replit or Lovable?
6. It's open source.
7. Now, what I need from you.

## Title slide (to make)

A video in Photos, 1920×1080, H.264, long enough to play through the opening and the ask without
looping (Photos doesn't loop videos): about 5 minutes. Almost still, with one slow calm motion,
the way a cinemagraph moves.

- Background: Whim's indigo from `release/store/play/en-US/images/featureGraphic.png`.
- The rounded white W and "Whim" as the centrepiece.
- The motion: TBD with Davron. Candidate: a few dandelion seeds drifting across, slowly (a
  dandelion is what you blow on a whim). Rendered in code, not stock footage, so it's crisp on a
  TV and on-brand.
- Top-right: the QR, white on indigo with a quiet zone, and "Try the beta" under it. Big enough to
  scan from the back of the bar: at least a sixth of the slide's height.

The QR's target is still open (see check 9).

## Q&A timer prompt (draft 5)

Test on the phone before the show and build the spare from it in the morning.

> A timer for the Q&A after my talk, readable on a big TV. A 4-minute countdown in huge numbers
> with a Start button. A big "Answered" button in the middle of the screen that I tap each time
> I finish answering a question. Show the number of questions answered, the average time per
> answer and the longest answer, and a list of every answer with how long it took. When time
> runs out, show "Time's up" with the stats. Keep the list saved, with a small Reset button to
> clear it.

## Rehearsal checks (only the phone can answer these)

1. **After "Leave it running", does the "…is ready" screen pop up by itself** when the build
   finishes, in the middle of the cheat sheet? If it does, rehearse closing it ("Back to your
   apps") without comment, or fold it in: "My timer's done. Later."
2. **How to leave History for the grid.** The research didn't find the control's label.
3. **Does v1 open on the note you were on?** Only if v1 stores its position (see "Building the
   cheat sheet"). If it opens on note 1, tap Next to note 4 and say "It even forgot where I was.
   Version one was rough."
4. **Where are the cheat sheet's Next button and the timer's Answered button?** The orb sits over
   the bottom-right corner of every mini-app. If the orb covers either, change that version's
   prompt.
5. **The swipes between Photos and Whim**, with the phone mirrored, a mini-app open, and a full
   minute on the title slide first. Swiping back to the app you just left only works until you
   use the new one; after that, iOS reorders the apps and the direction flips.
6. **Does the title slide fill the TVs?** Try it with the phone sideways, and upright: iOS may
   send a playing video full-screen to the TV either way.
7. **Which tile is the new timer**, next to the spare. Note where the ghost tile lands on the
   grid.
8. **Say the whole thing once with a timer.** The clock above is estimated at ~130 words a minute
   for a nervous speaker, and the phone's build time is still unmeasured.
9. **Before saying "open source" and before printing the QR:** see the README's open questions.
10. **Point the app at another server once**, before claiming it on stage: Settings, Advanced,
    "Server address", and see "Verified — this is a Whim server." Davron has never used it.

## How this draft was reached

**Pass 1: draft 4 run against the real UI.**

- Draft 4 went back to the grid by long-pressing the tile. There's no swipe out of a mini-app
  (decision #67). The way out is the orb, and its "Versions" item opens History in one tap, so
  both History trips now start from the orb.
- The rollback button inside the confirm sheet is "Go back to it", and it's the small one. Cancel
  is the big one. Under nerves the big button gets tapped, so the script names the small one.
- The sheet itself says "Your saved data stays". Pointing at that line on the TVs proves the
  point better than saying it, so the script reads it out.
- After a rollback the app doesn't reopen by itself; the toast "You're on v1 now" shows in
  History. Leaving History lands on the grid, where the timer tile is visible. That gave a free
  payoff ("my timer's done") that draft 4 didn't have: the build otherwise finished off screen.
- Clarify questions are pills, not typed answers, and the step can be skipped. Added the line
  for when it's skipped.

**Pass 2: the revised draft read for inconsistencies.**

- "Most of them build a web app you then have to host" wasn't true of Vibecode or Rork, which
  build App Store apps. Rewritten (and again in draft 6, below).
- The talk ended on the timer's stats, so the last thing the room heard was about Q&A length,
  not the beta. The closing line now points back to the QR.
- The timer prompt had no reset, so a spare built in the morning would show rehearsal answers.
  Added Reset, and the "Before walking on" list clears it.
- The Answered button had no position, and the orb covers the bottom-right corner. The prompt
  now puts it in the middle.

**Pass 3: read aloud, beat by beat.**

- Word counts fit their slots at ~130 a minute.
- A failed build used to surprise him at the end. The grid visit after the first rollback shows
  the tile, so a red "Didn't finish" there now means "use the spare later".
- "Swipe left to come back from Photos" assumed iOS keeps the app order. Check 5 tests it.

**Draft 6: Davron's notes on draft 5.**

- The opening and the why-story now play over a title slide in Photos instead of the home grid:
  the QR is up from the first second, and the same slide comes back for the ask. The build moves
  from 0:45 to 1:45; at a ~90-second build the tile still turns real before the first grid visit
  at ~5:00.
- The room is mostly sales and marketing. "Sandbox" became "locked in a box", "vibe coding" gets
  a one-line definition, and the safety note is titled "Is it safe?", the question they'd ask.
- The competitor note is honest now: same problem, different approach. Whim doesn't claim to beat
  Replit; it says who it's for and lets the room choose.
- New note: open source, with an invitation for developers (issues, pull requests) and the
  Report button for everyone else.
- The open-source note gained self-hosting: the app's Settings → Advanced → "Server address"
  points Whim at your own backend (verified in `copy.ts`), and Apache 2.0 asks nothing of someone
  who only runs a server; attribution applies only when they distribute copies.
- The ask no longer lists what the sign-up collects, because that depends on where the QR
  points (check 9).
