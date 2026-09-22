# Run of show (draft, retime after the first phone runs)

Total 15:00. Target 10:30 of talking, leave the rest for questions.

| Clock | Where the eyes are | What happens |
|---|---|---|
| 0:00 | Me | One sentence: name, that I built Whim alone this year. "Before I explain anything, let me start something." |
| 0:20 | Phone | Tap new app, dictate the prompt (or paste it). Whim asks up to three questions; answer them out loud, short. |
| 1:30 | Phone | Plan appears. Skim it, say one line about it ("it decided it needs a history screen, fine"), approve. Tap Leave it running. |
| 2:30 | Slides | The problem: everyone has a tiny app they'd never build. What Whim is. |
| 4:00 | Slides | How it differs from Replit/Lovable/Opal: it lives on the phone, no deploy, no account, and generated code runs in a sandbox that can't reach the network. (Security slide.) |
| 5:00 | Phone | Open a pre-built app. Use it for real for 60 seconds. |
| 6:00 | Phone | Long-press → History. Scroll versions. "Start a copy here" on an older one. Open the copy. |
| 7:30 | Phone | Back to the grid. If the ghost tile has turned real, open the new app and use it. If not, keep talking on slides until it does; hard stop at 9:00, then show the morning copy. |
| 9:30 | Slides | The ask: twelve Android testers for two weeks, QR on screen. TestFlight link for iPhone. |
| 10:30 | Me | Questions. |

## Scripted parts

The first 60 seconds and the ask are scripted word for word, because that's where nerves
hit. Everything else is bullet points.

Opening (draft):

> Hi, I'm Davron. I'm going to start something on my phone and then tell you what it is
> while it works. [dictate the prompt] ... It's asking me a couple of questions. [answer]
> Okay, it's writing a plan. I'll approve that in a second and we'll come back to it.

The ask (draft):

> Whim is on TestFlight and Google Play's closed beta as of this week. Google won't let me
> ship to production until twelve people have tested it for two weeks. So if you have an
> Android phone, that QR gets you in, and you'd be doing me a real favour. iPhone folks, the
> other link. And tell me what you'd build; that's how I pick what the model gets better at.

## Questions to have answers for

- "How do you secure it?" Generated code runs in a sandboxed WebView with no network, no eval,
  and a closed bridge; the host app decides what it can touch. Then offer to go deeper after.
- "Why not just use Replit / Lovable?" They build web apps you deploy somewhere. Whim builds
  things that live on your phone, next to your data, in a minute, with no account.
- "How do you make money?" Not the point yet; it's a learning ground first. Say that plainly.
- "What model?" Small coder models through OpenRouter, chosen by an eval on a corpus of
  small apps, not by feel.
- "What can't it build?" Anything that needs the network, the camera, or your contacts, by
  design. Say what that buys: nothing generated can leak anything.
