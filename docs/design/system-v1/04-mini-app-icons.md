# App tiles: how a tiny app gets a face

Phase B of `design-system-v1`. Decides what an app's tile shows on the home grid, in menus and in prose,
and how the generator chooses it. Builds on `01-direction.md` §3.4 (named tints) and §8.1 (one icon set).

## What a tile has to do

- **Be recognised in under a second** on a grid of 5 to 40 apps, most of them made in a minute and some
  thrown away the same day.
- **Cost nothing to make.** No extra model call, no image pipeline, no wait. The tile exists the moment the
  app does, and while the app is still being made.
- **Come out right from an LLM on the first try,** every time, with no human taste in the loop.
- **Look like one family** with the shell and with each other, in light and dark, at 24pt inline and at 64pt
  on the grid.
- **Pass contrast** and read for screen readers.
- **Carry state** (being made, failed, changing) without a second visual language.

Today's tile fails the first two in practice. The capture shows two "HA Hello App" tiles that can't be told
apart (`android/22-home-two-hello-apps-light.png`), "AP" for "A Pomodoro timer" because the working title
starts with an article (`20-home-building-ghost`), and the "DIDN'T FI…" pill truncating on the art
(`08-home-rebuild-pill-failed`). The letters carry no meaning: "TS" says nothing about splitting a bill.

## Options weighed

| Option | Recognition | Cost per app | First-try reliability | Family look | Verdict |
|---|---|---|---|---|---|
| Two-letter monogram + colour (today) | Low; letters, not meaning; duplicates collide | None | Perfect | Good | Replace |
| LLM-written SVG glyph | Medium; LLMs draw badly and inconsistently | Tokens per app | Poor; needs a renderer that tolerates bad paths | Poor; every tile a different hand | Reject |
| Generated raster icon (image model) | High when it works | An image call, seconds, money | Medium; style drift, odd text | Poor without heavy prompting | Reject; wrong spend for throwaway apps |
| User photo or emoji | High for the person who chose it | A step the user must take | n/a | None; emoji render per platform | Reject as default |
| **Glyph from a closed set + named tint** | High; a timer looks like a timer | None; two words in `defineApp` | High; picking a name from a list is what LLMs do well | Strong; one drawing hand, one palette | **Adopt** |
| Live tile (shows app state) | Highest for trackers | A new host channel | Medium | Good | Not in v1; see below |

## Decision

A tile is a squircle plate in the app's **tint** (its light value, in both modes), carrying one white
**glyph** from the shell's own icon set. The generator names both in `defineApp`:

```ts
export default defineApp({
  name: 'Pour Timer',
  tint: ['stone', 'rose', 'slate'],  // up to three TintName values, best first (01-direction §3.4)
  icon: 'timer',                     // one of the 147 glyphs (list below); other names resolve
  initial: 'Home',
  screens: { Home },
  capabilities: ['cues'],
});
```

Why this one:

1. **Meaning beats letters.** People scan a home screen by shape and colour; a cup, a drop, a die are read
   before any label.
2. **Closed sets are what LLMs are good at.** Choosing "timer" from a list is a classification task. The
   names come from Lucide, which models have seen in thousands of React codebases. Most of those predate
   Lucide's 2024 renames, so a model's first guess is often an old name (`home`, `alert-circle`) or one of
   the 1,350 outside the subset; the alias map and the fallback absorb both (below).
3. **One family by construction.** Every glyph is drawn on the same grid with the same stroke; every tint
   was tuned for the same contrast. A grid of tiles made by a model on different days still looks designed.
4. **It costs nothing and is there from the first second,** so a tile being made can already show its
   final shape language.
5. **The same two tokens serve every surface:** the 64 home tile, the 40 tile in the Whim sheet and History's
   header, the 24 inline tile, the 96 hero on Ready, the app's name in prose (the tint's value), and the app's
   own `primary` inside it. Those four sizes are the only tile sizes.

`AppSpec.tileColor` is retired in favour of `tint`. Both are static literals the build extracts exactly as
it extracts `capabilities` today (`server/src/generation/stages/check.ts:40-64`), so there is still one
source of truth and nothing is executed to find them.

## Fallbacks and collisions

Both names are forgiving: a near miss never fails a build or costs a repair turn, and nothing renders blank.

- **Tint.** The host assigns it: the first of the model's ranked tints not already used by any of the person's
  apps, else the least used. An alias map catches the names models reach for (red→`rose`, sky→`blue`,
  teal/green/lime→`ocean`, cocoa/yellow/orange→`stone`, graphite/grey→`slate`; the full map is in
  `01-direction.md` §3.4). An unknown name falls back to the tint at (hash of the app id) mod 10, with a build
  diagnostic. Installed apps with a hex `tileColor` map to the nearest light value by ΔE2000.
- **Glyph.** A build-time alias map resolves legacy Lucide names and common synonyms to one of the 147 with a
  diagnostic: `home`→`house`, `check-square`→`square-check`, `alert-circle`→`circle-alert`,
  `bar-chart-3`→`chart-column`, `drop`→`droplet`, `cart`→`shopping-cart`, `checklist`→`list-checks`. An
  unknown name falls back deterministically: the keyword table below on the name's parts, then on the app's
  name, else `circle`, the one glyph kept for fallback and not offered to the generator. The same resolver
  serves `Icon name` inside apps, which accepts any string. The eval tracks the invalid-icon rate.
- **A copy of an app** keeps its glyph and takes the tint farthest (ΔE2000) from the original among the least
  used, so the original and the copy differ at a glance. Its state line reads "Copy".
- **Two different apps landing on the same glyph** is possible and fine; host assignment keeps their tints
  apart while unused tints remain, and their names differ.
- **Customize tile** ships in v1: a context-menu row opening a sheet with the ten tints and a searchable glyph
  grid, stored host-side as an override that survives changes. It is the remedy for any bad pick.

Keyword table (first match on whole words of the lower-cased name; the full table ships with the icon set):

| Words | Glyph | Words | Glyph |
|---|---|---|---|
| timer, countdown, pomodoro | `timer` | water, drink, hydrat* | `glass-water` |
| alarm, wake | `alarm-clock` | coffee, espresso, pour-over | `coffee` |
| habit, streak, routine | `calendar-check` | tip, bill, split | `receipt` |
| todo, task, checklist | `list-checks` | budget, spend*, expense | `wallet` |
| dice, roll | `dice-5` | coin, flip | `coins` |
| plant, garden | `sprout` | recipe, cook, meal | `chef-hat` |
| workout, gym, reps | `dumbbell` | run, walk, steps | `footprints` |
| sleep, nap | `bed` | mood, feel* | `smile` |
| book, read* | `book-open` | note, journal, log | `notebook-pen` |
| score, game | `trophy` | pet, dog | `paw-print` |

## Glyph set

147 glyphs from `lucide-static@0.460.0` (ISC licence, vendored as path data, attribution kept), plus `circle`
for fallback only. The SDK reference lists the 147 in these groups; the SDK exports them as the `IconName`
union for reference, while `Icon name` and `defineApp` `icon` accept any string and resolve it as above.

| Group | Glyphs |
|---|---|
| Time | `timer` `alarm-clock` `hourglass` `clock` `watch` `calendar` `calendar-check` `calendar-days` |
| Food and drink | `coffee` `cup-soda` `glass-water` `droplet` `utensils` `chef-hat` `cookie` `apple` `carrot` `pizza` `wheat` `egg` `salad` `croissant` |
| Nature and weather | `leaf` `sprout` `flower` `flower-2` `trees` `tree-pine` `sun` `moon` `cloud` `cloud-rain` `snowflake` `thermometer` `wind` `umbrella` `flame` `zap` `waves` `mountain` |
| Body and health | `heart` `heart-pulse` `activity` `dumbbell` `bike` `footprints` `pill` `stethoscope` `bed` `brain` `smile` `baby` |
| Animals | `dog` `cat` `paw-print` `fish` `bird` `bug` |
| Home | `house` `sofa` `lamp` `key` `lock` `plug` `battery` `bell` `recycle` `trash-2` `shirt` `glasses` `scissors` |
| Money and shopping | `shopping-cart` `shopping-bag` `gift` `tag` `receipt` `wallet` `piggy-bank` `coins` `banknote` `credit-card` `calculator` `percent` |
| Goals and lists | `chart-column` `chart-line` `chart-pie` `trending-up` `target` `trophy` `medal` `flag` `star` `list-checks` `list-todo` `square-check` `clipboard-list` |
| Play and make | `dice-5` `dices` `puzzle` `gamepad-2` `music` `headphones` `mic` `guitar` `piano` `film` `camera` `image` `palette` `brush` |
| Learn and write | `pencil` `pen-tool` `book` `book-open` `notebook-pen` `graduation-cap` `languages` `lightbulb` `sticky-note` `file-text` `folder` `inbox` |
| People | `users` `user` `hand-heart` `handshake` `mail` `message-circle` `phone` `megaphone` |
| Places and travel | `map` `map-pin` `compass` `plane` `car` `bus` `train-front` `tent` `anchor` `globe` |
| Tools | `ruler` `scale` `wrench` `hammer` `repeat` `shuffle` `hash` |

Deliberately left out: `sparkles` and any wand (they say "AI made this", which every app here is), brand
marks, flags of countries, weapons, and anything whose meaning depends on culture.

## Tile anatomy

| Part | Spec |
|---|---|
| Grid | 4 columns, tile 64 on every phone width; column width = (screen − 2 × 20) / 4. Row gap 20 between a label and the next tile. From 135% text, three columns; from 200%, a list of rows with the 40 tile and the full name. |
| Sizes | 24 inline, 40 in sheets and headers, 64 on the grid, 96 as the hero on Ready. No others. |
| Shape | Superellipse, corner 22.5% of the side, one SVG path on both platforms. No border, no gloss, no ghost letterform. |
| Plate | The tint's light value in both modes. In dark mode a 1.5px inner rim in mix(dark value, light value, 50%) keeps the edge (≥ 3.53:1 on dark `bg`) without the glare of a bright plate. |
| Glyph | 50% of the tile (32 at 64), centred, white, stroke 2 in the 24-unit grid (2.7px rendered at 32). |
| Label | `caption` 12/16 weight 500, `text`, centred, up to two lines with 4pt side padding, then an ellipsis; the generator keeps names to 24 characters; the full name heads the context menu and is the accessibility label. |
| State line | Under the label, only for state: "Making…", "Didn't work", "Stopped", "Needs update", "Changing…", "Copy", "Example" (#42). `caption` in the role's text colour. |
| Badge | 18pt, at the top-trailing corner, for failed and change-failed tiles. |
| Touch | The whole column cell (tile + label) is one target, at least 64 × 84. |

## States

| State | Tile | State line | Tap | Long-press menu |
|---|---|---|---|---|
| Ready | Tint + glyph | none ("Example" on seeded examples) | Opens the app (morph from the tile) | Open, Change it, History, Make a copy, Customize tile, Share link, Delete |
| Pressed | Scales to 0.96 on touch-down | | | Tile lifts to 1.06 with `shadow-floating` at the 350 ms threshold, haptic, menu grows from it |
| Being made | `ember-soft` squircle with the 24 ember glowing with the stream (honest light) | "Making…" in `ember-text` | Opens the making view | Details, Stop |
| Queued | Same, ember still and dim | "Waiting…" `text-2` | Opens the making view | Details, Stop |
| Failed | `fill` squircle, the ember out, 18pt badge with `circle-alert` in `danger` | "Didn't work" `danger-text` | Opens the failure view | What happened, Try again, Discard |
| Stopped (by Stop, or the phone closed mid-make) | `fill` squircle, the ember out | "Stopped" `text-2` | Opens the failure view with "Try again" first | Try again, Discard |
| Older than a day (failed or stopped) | One `fill` squircle with the ember out, at the end of the grid | "2 didn't work" `text-2` | Opens a list of them | Discard all |
| Needs update | `fill` squircle, the ember out | "Needs update" `warning-text` | Opens the update screen | Update Whim, Discard |
| Changing (a change in flight on an installed app) | The app's tile with a 2pt `ember` ring 3pt outside, drawn as the same superellipse scaled out so it stays concentric, glowing with the stream | "Changing…" `ember-text` | Opens the app (current version) | Details, Stop the change |
| Change failed | The app's tile with the 18pt badge | "Change didn't work" `danger-text` | Opens the app | What happened, Try again, Discard the change |

The ember out is the mark's silhouette in `fill-strong` with no glow: Whim's light, gone out. The name under a
tile being made is a short working name: the name the plan response proposes when it has one, otherwise the
first three words of the description without a leading "A", "An" or "The" ("Pomodoro timer", not "A Pomodoro
timer", and not "A habit tracker: my…" as in `android/26b`).

When making finishes while the grid is on screen, the ember tile turns into the app's tile in place: the
glow flares (`spark`), the squircle fills with the tint from the centre out, and the glyph fades in at 0.9
scale and settles (`morph`). `05-motion.md` has the values.

## Accessibility

- Accessibility label: the name, then the state when there is one ("Pour Timer, making"). Hint: "Opens the
  app" or "Shows progress".
- The glyph is decorative to screen readers; the name carries the meaning.
- White on every light value clears 5.52:1, more than the 3:1 a glyph needs; the dark-mode rim clears 3.53:1
  on the canvas (`01-direction.md` §3.4).
- Increase Contrast adds a 1px `border` outline (3.07:1 on `bg`) to the squircle in both modes.
- Tints can look alike under colour blindness (ocean and berry under deutan); glyph and name always tell tiles
  apart, and no tint is ever confusable with a status or with ember.

## Choosing well: what the generator is told

The SDK reference gets one short section with both lists and four rules:

1. Pick the glyph for what the app is *about*, not what it looks like inside ("timer" for a pour-over timer,
   not "list-checks" for its steps).
2. Name up to three tints, best first, for the feeling of the subject: `stone`, `rose`, `berry` for food,
   home and craft; `ocean`, `blue`, `indigo` for focus, health and money; `violet`, `purple`, `orchid` for
   play; `slate` for tools. The host picks the first one the person isn't already using.
3. Keep the name to 24 characters; it wraps to two lines under the tile.
4. When changing an app, keep its glyph and tint unless the person asks for a new look.

Warm hues aren't in the list, so a tint can never be read as a status or as Whim. The corpus eval gets a case
that checks the pair is present, valid and stable across a change, and tracks the invalid-icon rate.

## Not in v1

**Live tiles.** A tile that shows "5 of 8 glasses" is the most useful idea on the table and I want it later.
It isn't in v1 because an app only runs while it is open, so the tile would show whatever the app last said,
possibly yesterday's count. That breaks honest light unless the line carries its age ("5 of 8 · yesterday"),
and it needs a new app-to-host channel through the containment model. It belongs with background execution
(capability tier 2), where the app can keep its line current.
