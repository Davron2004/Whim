# Demo formats (exploring, 2026-09-23)

Davron had doubts about the cooking show on Wednesday and asked for very different structures
to choose from or merge. What we know about the room: a mixed tech crowd, seated, facing the
TVs. Audience participation is light touch only: a show of hands or a pick between options
Davron prepared, never a prompt shouted from the floor. Delivery style is undecided, so each
format below says what it sounds like. Build time from the phone is still unmeasured; the bench
says ~90 s (README, Constraints).

## The ask, solved once for every format

Davron wants four things from the room: what they'd build, what features and customisation they
want, what should be better, and where Whim met or broke their expectations. Asked on stage,
that's four questions to people who haven't touched the app yet. Only the first can be answered
before trying it. So split them by when people can answer:

1. **In the room, out loud, one question: "What would you build with it?"** Every format ends
   on this.
2. **The QR: one short page.** Email, iPhone or Android, and "one app you'd build". It's the
   sign-up both stores need anyway (README, Open questions), and the answers are the
   feature-request data.
3. **After they've tried it:** TestFlight's "What to Test" already asks what they built, what
   they expected that it didn't do, and what they'd change first. Three days after the event,
   one email to the sign-up list asks the same for Android people.

On stage it's enough to say the shape of it: "I'll ask you one thing tonight and three more
things after you've played with it."

## What comparable products did

From a research pass on 2026-09-23 (a subagent's digest; the sources are its, not re-checked).
Worth copying, in one line each:

- **Riley Brown / Vibecode app**: sits on a couch, phone only, describes an app in plain
  English, no IDE on screen. The closest analog to Whim. Copy: the phone is the whole stage.
- **Rork**: a QR on screen the moment the app exists, so viewers run it on their own phone.
  Copy: the QR appears as a payoff, not as a final-slide chore.
- **base44 (Maor Shlomo, solo founder)**: grew by building in public. He posted bugs fixed, real
  numbers and plain demos, no polished keynotes. Copy: honesty about the state of things as the
  pitch itself.
- **Lovable**: finishes a recognisable, complete app, not a toy. Copy: pick a prompt people
  recognise from their own lives.
- **Google Opal**: a gallery of remixable starters so nobody faces a blank prompt. Copy: the
  room chooses from prepared options instead of inventing one.
- **Bolt.new**: grew through users posting their own generations. Copy: make the moment
  shareable, so people take a photo of something.
- **Steve Jobs, 2007**: the pain first, then one clean reveal. **YC demo day**: one ask, always a
  recorded backup, don't explain the mechanism.

The pattern nobody seems to have solved well is the generation wait. Either narrate over it or
cut to something already finished. Whim's "Leave it running" is a third option most tools
don't have.

## Eight formats

Each gets its shape, how it sounds, what it's best at, and the risk.

### A. Cooking show (the current plan)
Start a build in minute one, pitch over the wait, pre-built app and History in the middle,
reveal, ask. **Sounds like:** calm host, "let me start something". **Best at:** proving it's
live and real. **Risk:** at ~90 s builds the reveal lands during the problem slide, not at the
climax. It needs reordering or a later start once the phone runs are timed.

### B. The room picks the app — rejected 2026-09-23
Davron's reason: the constraints on mini-apps are strict, and Whim has no way yet to tell a user
a request is impossible (a weather app needs the network; there's no way around it). That gap is
issue #70. Even with prepared options, the format invites "can it do X?" requests the product
can't answer yet. Kept for the record:

A slide with three prompts, all rehearsed today. Hands up, the most hands wins, and Davron builds
it. **Opening:** "I've got three apps I could build right now. You decide." **Sounds like:**
game-show host, light. **Best at:** the audience owns the result, and the vote is itself the
first answer to "what would you build". **Risk:** three prompts to rehearse instead of one.
Keep them close in size so whichever wins behaves the same.

### C. The feedback machine
The app on stage is the tool for the ask. "I have four questions for sixty people and nothing to
collect answers with, so let me build one." It's a hand-count tally: one row per question with a
+ button. During the ask Davron reads each question, the room raises hands, and he taps the
counts in live. The final tally is his first user research, and he can post it the next day.
**Sounds like:** a builder with a real problem. **Best at:** the demo and the ask are the same
thing, and it shows a real use, not a toy. **Risk:** tapping counts while talking is fiddly, so
rehearse it. A generated tally app must be big-button and dead simple; test the prompt for that.

### D. The app I actually needed
A 30-second true story from Davron's life, then build exactly that app. **Opening:** "Last
month I wanted ___ and there was no app small enough." **Sounds like:** personal, a bit
vulnerable, first-demo honest. **Best at:** people remember stories, not features. **Risk:**
needs a real story. Only Davron has it, and it has to be one the model builds well.

### E. Build it, live in it, change it, rewind it
One app through its whole life: build → use it for real → "Prompt again" to change it (the
LinkedIn film's "add a streak counter" moment, where the data survived) → History, branch from
v1. **Sounds like:** a tour guide with one object. **Best at:** "change it and it keeps your
data" and "go back to any version" are the things nobody else in the room can show. **Risk:**
two builds on stage, back to back, and one generation per device at a time.

### F. Race the clock
A big timer on the TV: "It'll be done before I finish telling you why I built it." **Sounds
like:** playful, a bit of swagger. **Best at:** energy, and the speed claim made visible.
**Risk:** only works if phone builds are reliably under ~2 minutes. The timed runs decide
whether it's even possible.

### G. Try to break it
Security-led, for the technical half of the room. Show a pre-built app, then what generated
code can't do: no network API, no camera, no contacts. Name the one open gap honestly
(run-of-show, Questions). **Sounds like:** straight engineer. **Best at:** credibility with
developers, and it answers "is this safe" before anyone asks. **Risk:** loses the non-technical
half, and live negative demos are hard to make visible.

### H. The lab notebook
Build in public, on stage. The real state of Whim: when it started, how many builds, a build
that failed (from History), what's next and what's undecided. "You're deciding the roadmap
tonight." **Sounds like:** honest founder, first demo. The nerves become part of the story.
**Best at:** the ask. People give feedback to someone who clearly needs it and says so. **Risk:**
too much honesty reads as unfinished. It still needs one clean live success.

### I. The couch demo
No slides. Phone mirrored full-screen the whole time, a conversation with the room. **Sounds
like:** relaxed, like showing a friend. **Best at:** zero kit risk and maximum focus on the
product. **Risk:** with no slides there's nothing to lean on when nerves hit, and no screen for
the QR unless it's on the phone.

## Merges worth considering

B is out, so every prompt on stage is one Davron chose and tested on the phone, and it must
stay inside what a mini-app can do (no network, no camera, no contacts).

- **E + ask:** the build runs, then change it and rewind it. The strongest product story.
- **C inside A or E:** the tally app (pre-built that morning) takes the "pre-built app" slot in
  the middle and runs the ask. The room still takes part, through hands, not prompts.
- **D + H:** a story opening and an honest ending around one clean build. The most human, the
  least product surface.

## Open

- Which format or merge to take forward. Rehearsal, the prompt list and the slides all follow
  from it.
- For D: Davron's real story, if there is one.
- For C: the tally prompt, tested on the phone before it goes in.

## Chosen direction (2026-09-23, evening): roughly A + C + D + I

Davron's call:
- **I (couch demo):** yes, now that the phone can drive the venue TVs directly (README,
  Decisions).
- **A:** one app is built live and runs in the background.
- **C:** a hand-count tally app exists.
- **D:** the apps are ones he actually needs tonight, and inside what Whim can build. The app
  that first made him want Whim needs capabilities Whim doesn't have.
- A pre-built app shows its History: it started primitive, gained animations and polish through
  prompts, and the data typed into it survived every version. That covers "change" and "rewind"
  without doing either live.

Not wanted: a live "Prompt again" (too long for an app this small), E as a live sequence, G
(nobody finds a failed attack interesting, and there's no prompt that shows it), F.

D candidate from Davron: an "um counter". He taps a button every time he says "um" or stutters.
It's self-deprecating, immediately useful, and a manual tap, since Whim has no microphone access.

### Proposal: which app plays which role (superseded)

Superseded the same evening: it was two counters again. Davron's replacement is the
cheat-sheet app; the plan is in `run-of-show.md`.


Two counter apps side by side would look like the same app twice. So give them different jobs:

- **Pre-built, with History: the Um Log.** A session log of ums: a big tap button for the current
  session, and past sessions with a small chart across them. Build v1 today, deliberately plain,
  before the first run-through. Log every rehearsal in it. Thursday morning, Prompt again for
  animations, the chart and polish. On stage, History shows plain → polished, and the rehearsal
  counts (real ones, trending down, with luck) are the data that survived. It's open and
  counting from minute one.
- **Built live: the hand tally.** "In eight minutes I want to ask you some questions, and I've
  got nothing to count hands with. Let's make that." One row per question, big + buttons. The
  build runs in the background while he talks; he opens it for the ask and taps the counts in
  as hands go up. A deadline the audience can see, and a payoff they take part in.

The swap, compared with Davron's first framing (live build = something else, pre-built = the
tally): the Um Log's History then carries real data instead of staged data, and the live build
has a job waiting for it.

### Rough shape (retime after the TV test and the phone runs)

| Clock | What happens |
|---|---|
| 0:00 | Name, first demo, nervous: opens the Um Log, "this counts how many times I say um tonight". |
| 0:40 | New app: the hand tally prompt. Questions, plan, Leave it running. |
| 2:00 | What Whim is and why: talking over the Um Log and the grid, tapping ums as they come. |
| 4:00 | Um Log → History: v1 plain, the prompt that changed it, now; the rehearsal data intact. "Every version is kept; I can branch from any of them." |
| 5:30 | How it's different, one or two sentences, no slide. |
| 6:30 | The ask: open the hand tally, ask the questions, count hands live. QR for sign-up. |
| 8:30 | Final um count. "Download it, try it, tell me what you'd build." |
| 9:00 | Questions. |

### Open

- Davron's OK on the role swap.
- Slides: with the phone on the TVs, a deck would also have to live on the phone (Keynote on
  iPhone presents to an external display). Leaning toward no deck: a title image and the QR
  as images in Photos.
- The hand-tally questions: each has to work as a show of hands and feed the four feedback
  questions.
- Fallback when the live build fails: a copy of the hand tally built that morning, on the grid.
