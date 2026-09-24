# Stage script (draft 7, 2026-09-24): the simulated run

Every beat of the talk: the clock, what the TVs show, what Davron's thumb does, and whether he's
speaking or silent. Words in "quotes" after **Say** are his, word for word. UI labels in
"quotes" are verbatim from the app (`src/host/launcher/copy.ts`, checked 2026-09-24 against the
commit the phone build came from). Lines in [brackets] are filled in on the night.

Replaces draft 4 and the minute table in `run-of-show.md`. Still valid there: "Questions to have
answers for". How this draft was reached, and what only a phone rehearsal can settle, is at the
bottom.

The room is mostly sales and marketing people, with some engineers. Every line has to make sense
to someone who has never written code; the engineers get their part in the open-source beat and
in Q&A.

About 950 spoken words over 8½ minutes, then a 4-minute Q&A on the timer, ending near 12:45 in a
15-minute slot.

## Three screens

- **The title slide**, a video in Photos: Whim's indigo, the rounded W, slow calm motion, the QR
  in the top-right corner with "Get early access". Landscape, so it fills the TVs. It carries the
  opening, comes back for the ask, and stays up at the very end.
- **Whim**, portrait, for everything in between.
- **The iPad**, out of the audience's sight (under the desk), with this script. Only Davron sees
  it. The TVs show the cheat sheet; the iPad holds the words.

Switching between Photos and Whim is a swipe along the bottom edge of the phone. The TVs jump
between landscape and portrait when it happens; that's fine.

## Before walking on

- Open Photos on the title slide video, then switch to Whim, then back to Photos, so Whim is one
  swipe away. The talk starts on the title slide.
- The timer prompt is on the clipboard. Copy nothing after it.
- Whim is on its home grid underneath. Do Not Disturb on, auto-lock off, rotation lock off,
  phone in the adapter, TVs mirroring.
- The spare timer's answers are cleared (Reset), so it shows no rehearsal data or bars if it's
  needed.
- Build budget: the server allows 15 builds per phone per UTC day, and the day doesn't reset
  before the talk (it started at 8 pm the evening before, Toronto time). Count what's left. The
  stage needs one.
- The iPad is on this script, screen brightness down, auto-lock off.

## 0:00–1:45 · Who, what, why · SPEAKING, from memory

**TVs:** the title slide, playing. The QR is up from the first second, so early scanners scan.
**Thumb:** nothing.

**Say:** "Hi, I'm Davron. I'm a software developer, and a math and CS student at U of T, on a gap
year right now.

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

That QR code will come back at the end, after I show you the app. Let me show you."

## 1:45–2:00 · Start a build · SPEAKING, from memory

**Thumb:** swipe to Whim, turn the phone upright. **TVs:** the home grid. "Whim", "Your apps",
the tiles, "Describe an app…" along the bottom.

**Say:** "At the end I'll take your questions, and I ramble, so I want something that keeps me
honest. Let's build a Q&A timer."

**Thumb:** tap "Describe an app…". **TVs:** "What should it do?", the keyboard up.

## 2:00–2:10 · The prompt · SPEAKING

**Thumb:** long-press the field, Paste. The prompt fills the field.

**Say:** "I'm asking for a four-minute countdown, a button I press every time I finish an
answer, and a live chart of how long each answer takes."

**Thumb:** "Continue". The button reads "One moment" for about 2 seconds.
**SILENT** for those 2 seconds. Don't fill them.

## 2:10–2:35 · Clarify · SPEAKING

**TVs:** "Two quick things" (or One or Three), each question a row of pills.

**Say:** "Before it builds anything, it asks me questions, the way a person would, if it needs
to. Otherwise it goes straight to the plan."
Then each question and your pick, out loud as you tap: "[Question]? [Answer]."

If it goes straight to the plan instead: "This time it didn't need to."

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

## 3:10–4:00 · The cheat sheet, note 1 · SPEAKING

**Thumb:** tap the cheat sheet tile. A second of loading (**SILENT**).
**TVs:** note 1, "Hi. These are my notes. Yes, you can read them."

**Say:** "While that cooks, let me show you an app I already made with Whim. I'm using it right
now: these are my speaker notes, and I'm giving this talk from them. I lose my train of thought
when I'm nervous, so I asked Whim for a notes app that shows one note at a time, in big letters.
So yes, you get to read my notes. There's nothing embarrassing in there. Probably."

**Thumb:** Next.

## 4:00–4:35 · Note 2, "Is it safe to run code an AI wrote on your phone?" · SPEAKING

**Say:** "Fair question. Every app Whim makes runs locked in a box. It can't go on the internet,
it can't see your contacts or your camera, and it can't read what's in your other apps. That
means Whim can't make some apps, like one that shows the weather. I made that trade on purpose,
because it means nothing Whim makes can leak your stuff."

**Thumb:** Next.

## 4:35–5:10 · Note 3, "This app didn't always look like this." · SPEAKING while tapping

**Say:** "This notes app didn't start out looking like this. Every time I asked Whim for a
change, it kept the version before. Let me show you."

**Thumb:** the orb (bottom-right), "Versions".
**TVs:** the cheat sheet's history, "4 versions", one row per version, each with "You said" and
what was asked.

**Say:** "Here's its history. Four versions, and each one shows what I asked for. This is the
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

## 5:10–5:35 · Version 1 · SPEAKING, one silence

**TVs:** the cheat sheet v1: plain, small, on note 3.

**Say:** "This is version one. It's ugly."
**SILENT** for two seconds. Let them laugh.
**Say:** "But all my notes are still here, in the same order. Changing the app never touched the
notes in it."

**Thumb:** Next. **TVs:** note 4, "Version one. Ugly, but every note survived.", in v1's
styling.

**Say:** "Okay, I can't present from this. Back to the good one."

## 5:35–6:00 · Forward to v4 · SPEAKING while tapping

**Thumb:** orb, "Versions", tap the v4 row, "Go back to this", "Go back to it". Toast: "You're
on v4 now". Leave History, tap the cheat sheet tile.

**Say**, over the taps: "Going back didn't delete anything. The newer versions stay in the list,
so I can come forward the same way."

**TVs:** the cheat sheet v4 on note 4.
**Say:** "And it's back, on the same note."

**Thumb:** Next.

## 6:00–6:35 · Note 5, "Why not Replit or Lovable?" · SPEAKING

**Say:** "People ask me how this is different from Replit, Lovable or Base44. Honestly, we're
solving the same problem: you describe software and AI builds it. We go about it differently.
First of all, those tools help you build something to publish, for other people. Whim is for
software you make for yourself, for one job. It lives on your phone, what you put in it stays on
your phone, and every app is locked in that box."

**Thumb:** Next.

## 6:35–7:10 · Note 6, "And Whim is open source." · SPEAKING

**Say:** "Second of all, Whim is open source. All of it is on GitHub, so anyone can check what it
does. If you're a developer, open an issue, or send me a pull request, and I might even merge it.
You can also run the server yourself: the app has a setting for your own server address, and
then how Whim builds apps is yours to change. If you're not a developer, every Whim app has a
Report button, and those reach me."

**Thumb:** Next.

## 7:10–8:10 · Note 7, "What I need from you…" · SPEAKING, then SILENT

**TVs**, for a second: note 7, "What I need from you: scan the QR, leave your email, and you're
first in when the beta opens."

**Thumb:** swipe to Photos, turn the phone sideways. **TVs:** the title slide, QR top-right.

**Say:** "Here's the QR I promised. Apple and Google are still reviewing Whim, so you can't
download it tonight. Scan this, leave your email, and you're first in when it opens. And tell me
one app you'd build. Android people: Google won't let me launch until twelve testers use it for
two weeks, so I really do need you. Use the email of the Google account on your phone."

**SILENT** for eight to ten seconds, QR held, while the phones come up. It will feel endless.
Hold it anyway.

## 8:10–8:30 · The timer · SPEAKING

**Thumb:** swipe back to Whim (it lands on the cheat sheet), turn the phone upright, orb,
"Home", tap the new timer tile.

**Say:** "And now the timer I built at the start."

If its tile has a red border and "Didn't finish": "That one didn't make it. It happens. So I made
a spare this afternoon, in case the demo gods hate me." Tap the spare.

**TVs:** the timer at 4:00, the chart empty.
**Say:** "You've got four minutes. Every time I finish an answer I press this, and the chart
shows you how badly I ramble."

**Thumb:** Start.

## 8:30–12:30 · Q&A · on the timer

**TVs:** the countdown, a new bar after every answer, the stats updating.
**Thumb:** "Answered" after each answer. Answers for the likely questions: `run-of-show.md`,
"Questions to have answers for".

When "Time's up" shows, finish the sentence you're in, then:

**Say:** "[N] questions, [X] seconds on average, and the longest was [Y]. [To whoever asked it:]
That one was you."

## 12:30–12:45 · Close on the QR · SPEAKING

**Thumb:** swipe to Photos, turn the phone sideways. **TVs:** the title slide, QR top-right.

**Say:** "The QR's back up. Leave your email, and I want to hear what you build. Thank you."

Leave the slide up. Walk off with it still on the TVs.

## Cheat-sheet notes (on the TVs, in the app)

1. Hi. These are my notes. Yes, you can read them.
2. Is it safe to run code an AI wrote on your phone?
3. This app didn't always look like this. Whim keeps every version.
4. Version one. Ugly, but every note survived.
5. Why not Replit or Lovable? They build things to publish. Whim builds things just for you.
6. And Whim is open source. Anyone can check what it does, or run their own server.
7. What I need from you: scan the QR, leave your email, and you're first in when the beta opens.

The cheat sheet has four versions. Editing the notes' text by hand is free; a change prompt costs
a build.

## Title slide

A video in Photos, 1920×1080, H.264, about 5 minutes (Photos doesn't loop videos), rendered by
`demo/tools/title-slide.py`. Almost still, with one slow calm motion, the way a cinemagraph moves.

- Background: Whim's indigo. The rounded white W and "Whim" as the centrepiece.
- Top-right: the QR, white on indigo with a quiet zone, and "Get early access" with it.
- The QR points at `https://whim.anycognition.ca/beta`, the waitlist page (email and phone type).
  The URL stays the same after launch; the page behind it changes to store links then.

```sh
uv run demo/tools/title-slide.py --url https://whim.anycognition.ca/beta --label "Get early access"
```

## Q&A timer prompt (draft 6, tested on the phone 2026-09-24)

The build from the afternoon test is the spare.

> A timer for the Q&A after my talk, readable on a big TV. A 4-minute countdown in huge numbers
> with a Start button. A big "Answered" button in the middle of the screen that I tap each time I
> finish answering a question; each answer's time counts from Start or from my previous tap.
> Under it, a bar chart that grows live: one bar per answer, labelled with how many seconds it
> took. Also show how many questions I've answered, the average time per answer and the longest
> answer. When time runs out, show "Time's up" with the stats and the chart. Keep the answers
> saved, with a small Reset button to clear them.

## Rehearsal checks (only the phone can answer these)

1. **After "Leave it running", does the "…is ready" screen pop up by itself** when the build
   finishes, in the middle of the cheat sheet? If it does, rehearse closing it ("Back to your
   apps") without comment, or fold it in: "My timer's done. Later."
2. **How to leave History for the grid.** The research didn't find the control's label.
3. **Does v1 open on the note you were on?** If it opens on note 1, tap Next to note 4 and say
   "It even forgot where I was. Version one was rough."
4. **Where are the cheat sheet's Next button and the timer's Answered button?** The orb sits over
   the bottom-right corner of every mini-app. If the orb covers either, change that version's
   prompt.
5. **The swipes between Photos and Whim**, with the phone mirrored, a mini-app open, and a full
   minute on the title slide first. Swiping back to the app you just left only works until you
   use the new one; after that, iOS reorders the apps and the direction flips. The talk now
   crosses to Photos twice (the ask and the close).
6. **Does the title slide fill the TVs?** Try it with the phone sideways, and upright: iOS may
   send a playing video full-screen to the TV either way.
7. **Which tile is the new timer**, next to the spare. Note where the ghost tile lands on the
   grid.
8. **Say the whole thing once with a timer.** The clock above is estimated at ~130 words a minute
   for a nervous speaker, and the phone's build time is still unmeasured.
9. **Before saying "open source":** the Apache 2.0 license is on main. Confirm the GitHub repo is
   public. **Before showing the QR:** scan it from across a room and check `/beta` is live.
10. **Point the app at another server once**, before claiming it on stage: Settings, Advanced,
    "Server address", and see "Verified — this is a Whim server." Davron has never used it.
11. **Can the room read the chart?** Mirror the timer to a TV and check the bar labels from a few
    metres away.

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
  a one-line definition, and the safety note is titled as the question they'd ask.
- The competitor note is honest now: same problem, different approach. Whim doesn't claim to beat
  Replit; it says who it's for and lets the room choose.
- New note: open source, with an invitation for developers (issues, pull requests) and the
  Report button for everyone else.
- The open-source note gained self-hosting: the app's Settings → Advanced → "Server address"
  points Whim at your own backend (verified in `copy.ts`), and Apache 2.0 asks nothing of someone
  who only runs a server; attribution applies only when they distribute copies.

**Draft 7: Davron's notes on draft 6, the day of the talk.**

- Neither store listing is public yet, so the QR points at a waitlist on Whim's own server
  (`/beta`: email and phone type) instead of the stores. The ask says so plainly, and Android
  people are asked for their Google account email, which is what Play's closed testing needs.
  The slide label is "Get early access".
- "On leave" became "on a gap year". "This is my first demo ever, so be nice" is cut; the
  opening instead promises the QR comes back, and the ask opens with "Here's the QR I promised".
- The talk now ends on the QR, not on the timer: after the stats line, one swipe back to Photos,
  and the slide stays up as Davron walks off. The QR is on screen when interest peaks, without
  giving up the timer, which is the talk's strongest beat: the app built on stage does a job in
  the room.
- The timer draws a live bar chart of each answer's length (tested on the phone the same
  afternoon; that build is the spare). The answer list is gone: a TV can't fit both.
- The cheat sheet gets a real introduction (it's the app the talk runs on). The notes are
  written for the room, not just as cues: someone who looks up mid-sentence can follow.
- The Replit note and the open-source note are one argument, "First of all… / Second of all…".
- Clarify is described once for both cases ("if it needs to. Otherwise it goes straight to the
  plan").
- The cheat sheet has four versions, so History shows "4 versions" and the forward trip goes to
  v4.
- The ask's silence is eight to ten seconds, not five.
- The full script lives on an iPad under the desk; the TVs only ever show the cheat sheet.
