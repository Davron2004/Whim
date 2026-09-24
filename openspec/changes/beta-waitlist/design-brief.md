# Design brief: Whim's beta waitlist page

You're designing one small web page and its two result pages. Treat it as a design job, not a form
job. Most of the look is yours to decide. The parts under "Locked" are not: they come from Whim's
design system and from the server the form talks to.

## What this is

Whim is a phone app (iOS and Android) that makes small apps from a plain-words description. It isn't
in the stores yet: Apple and Google are both still reviewing it. On 2026-09-24 Whim is demoed live
at a bar, in front of mostly sales and marketing people. The last slide carries a QR code that
opens `https://whim.anycognition.ca/beta`. That's this page.

The visitor holds a phone, stands in a noisy room, and was looking at a big indigo slide a second
ago. They should be able to leave their email in about ten seconds, and the page should feel like
the calm end of that slide, not like a SaaS signup.

Three pages:
- `/beta`: the signup.
- `/beta/thanks`: where a successful signup lands.
- `/beta/retry`: where a refused signup lands (bad input, or too many tries). Static: it can't say
  which.

## The vibe (open to interpretation)

Reference: `../Whim-demo/demo/tools/title-slide.py`, which renders the stage slide the visitor just
saw. Run it with `uv run demo/tools/title-slide.py --url https://example.com --still` from that
repo, or read its drawing code. It's indigo dusk, almost still, with one small thing drifting slowly
across every 45 seconds, like a cinemagraph. Take the calm, the stillness, the single slow motion and
the restraint. **Don't take the dandelion.** It isn't Whim's mascot and shouldn't become one. Find
your own quiet element, or use no motion at all if the page is better still.

Also yours: layout, composition, headline and supporting copy (within the voice rules below),
whether the page leads with indigo like the slide or with paper like the app, how the platform
choice looks (pills, cards, a segmented control), the result pages' design, and any illustration.

## Locked: Whim's design system

The full system is `docs/design/README.md` (tokens, voice, motion) plus
`docs/design/reference/Whim Design System.dc.html` (open it in a browser). What applies here:

**Colour.** Use only these. The shell palette is almost colourless on purpose, so that colour
always means something.

| Token | Hex | Use |
|---|---|---|
| paper | `#fbfaf8` | Background |
| surface | `#f1efea` | Inputs, cards |
| border | `#e0dcd4` | 1px hairlines |
| ink | `#17171a` | Dark panels |
| text | `#1c1917` | Body text |
| muted | `#6b6560` | Secondary copy |
| faint | `#a8a29a` | De-emphasis only; fails AA on paper, so never for text a person must read |
| accent | `#3f3d8f` | Whim's indigo: primary action, links, the brand field |
| yours | `#a15c07` | Reserved for words the user wrote. Probably unused here; don't use it as decoration |

Status colours are reserved for their meaning: done `#0d9488`, broken `#b91c1c`, waiting
`#c9c3b8`. You may use done for the thanks page and broken for the retry page, nowhere else. On
`ink` or indigo use `#2dd4bf` / `#f87171`. Never `#4f46e5` (the retired framework indigo), no
gradients that travel or shimmer, and no colours outside this table.

**Type.** Three faces, from `assets/fonts/` in this repo (OFL-1.1):
- **Instrument Sans** (400/500/600/700): everything the page says.
- **IBM Plex Mono** (400/500): only for measured things or small uppercase eyebrow labels. Never
  prose.
- **Newsreader Italic**: only the user's own quoted words, never headings or page copy. It
  probably has no place here, and that's fine.

Reference scale: display 700 · 34px/1 · −0.03em; title 700 · 26px/1.15 · −0.025em; body 400 ·
15px/1.7 (use ≥16px inside inputs, or iOS zooms); caption 12px/1.55; eyebrow Plex Mono 500 ·
10.5px · +0.14em · uppercase. Radii: chip 999px, field 14px, card and primary button 18px, tile
22px. Spacing steps: 8 / 12 / 16 / 22 (screen gutter) / 34.

**Brand mark.** The rounded W is `release/assets/icon-foreground.svg`. Inline it as SVG, in white on
indigo or indigo on paper. The wordmark "Whim" is set in Instrument Sans SemiBold.

**Voice.** Minimal. Sentence case. **No exclamation marks, ever.** Say what happens, briefly. A
touch of whimsy is allowed as one vivid word inside a short sentence, never as an extra clause.
The site speaks as "we". On the retry page, zero whimsy: the sentence gets shorter, not warmer. No
emoji.

**Motion.** Slow and calm; one moving thing at most. CSS or inline-SVG animation only. Under
`prefers-reduced-motion: reduce`, everything is still.

## Locked: the platform (the page must work under this)

The pages host serves static files with this Content-Security-Policy, and the page must work
under it with zero console violations:

```
default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'
```

That means:
- **No JavaScript at all**: no `<script>`, no `on*=` attributes. Interactivity is HTML and CSS
  only (`:has()`, `:checked`, `:focus-visible`, `:user-invalid` are all fair game).
- **No external requests**: no Google Fonts, no CDNs, no analytics, no remote images. Styles go in
  one inline `<style>` per page. Fonts and any image files are same-origin under `/assets/`.
- **Fonts:** convert the TTFs you use to WOFF2 (a Latin subset is fine), put them in
  `deploy/site/assets/fonts/` with the OFL notice alongside, use `font-display: swap`, and give a
  system fallback stack.
- `color-scheme: light`. The shell palette isn't themeable, so there's no dark mode.
- Light page weight: the three pages plus assets under ~250 KB total. People on bar LTE will load
  it.

## Locked: the form contract (the server depends on this exactly)

```html
<form method="post" action="{{WHIM_BETA_SIGNUP_URL}}">
```

| Field | Markup | Notes |
|---|---|---|
| `email` | `<input type="email" name="email" required maxlength="254" autocomplete="email">` | Visible label |
| `platform` | three radios, `name="platform"`, values `ios`, `android`, `other`, one required | Labels read **iOS**, **Android**, **Other**. Not "iPhone". A `<fieldset>` with a `<legend>` |
| `updates_opt_out` | `<input type="checkbox" name="updates_opt_out" value="1">`, **unchecked** by default | Label: "Don't email me about Whim updates". The owner may still change this wording |
| `company` | a text input the server treats as a bot trap | Hidden from people (off-screen, `tabindex="-1"`, `autocomplete="off"`, `aria-hidden="true"`). Never `type="hidden"`, since bots skip those |

`{{WHIM_BETA_SIGNUP_URL}}` and `{{WHIM_SUPPORT_EMAIL}}` are build-time placeholders. Leave them
literally in the HTML, and use no other `{{…}}` or `<!--…-->` markers (the site build fails closed
on unknown ones). When previewing locally, the raw placeholders are expected.

**Required copy.** Word it in Whim's voice, but keep every point:
1. Near the form, a consent line: we keep the email and phone type to invite them to the beta, and
   unless they tick the box, we may occasionally email about Whim. Anyone can leave the list by
   writing to `{{WHIM_SUPPORT_EMAIL}}`. Link to `/privacy`.
2. When Android is selected (CSS `:has()` is enough), a hint: use the email of the Google account
   on that phone, because Google Play invites testers by that address.
3. The thanks page says what happens next, without promising a date: Android people get a Google
   Play invite at that address, and iOS people get an email with the TestFlight link once Apple
   approves the beta. It links back to nothing in particular; it's an end.
4. The retry page says it didn't go through and offers one way back to `/beta`. The static page
   can't know why, so it doesn't guess.

Every page links `/privacy` in the footer.

**Consent markers.** Put `data-notice` on the element holding the consent line (point 1) and on
the opt-out checkbox's `<label>`. The site build fingerprints the text of those elements, so the
server can record which wording each signup agreed to. You can style them however you like. If
you change their wording, the build will tell you to register the new wording. That's expected:
say so in your report, and the implementer registers it.

## Accessibility (locked)

AA contrast for all text a person needs to read. Every input has a real `<label>`, and focus is
always visible. Tap targets are ≥44px. It works at 320px wide with no horizontal scroll, and looks
right up to desktop width. `lang="en"`. The page must stay usable with CSS off: plain labelled
form, top to bottom.

## Deliverables and boundaries

Work in the worktree `/Users/davrondjabborov/Work/other/Whim-waitlist` (branch
`proposal/beta-waitlist`). The only files you touch:
- `deploy/site/beta.html`, `deploy/site/beta-thanks.html`, `deploy/site/beta-retry.html`
- `deploy/site/assets/**` (fonts, their license, any image)

Don't touch anything else. The server, the Caddyfile, the site build and the privacy policy belong
to the implementer building the backend in the same change. When you're done:
- Commit on the branch.
- Report screenshots of all three pages at 375px and 1280px, the total asset weight, and confirm
  zero CSP violations when served with the header above. For example, serve `deploy/site/` locally
  with that header set, then check the console.
