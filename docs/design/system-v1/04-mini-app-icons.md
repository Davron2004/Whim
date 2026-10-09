# App tiles: how a tiny app gets a face

Phase B of `design-system-v1`. Decides what an app's tile shows on the home grid, in menus and in prose,
and how the generator chooses it. Builds on `01-direction.md` §3.4 (named tints) and §8.1 (one icon set).

## What a tile has to do

- **Be recognised in under a second** on a grid of 5 to 40 apps, most of them made in a minute and some
  thrown away the same day.
- **Cost nothing to make.** No extra model call, no image pipeline, no wait. The tile exists the moment the
  app does, and while the app is still being made.
- **Come out right from an LLM on the first try,** every time, with no human taste in the loop.
- **Look like one family** with the shell and with each other, in light and dark, at 16pt in a menu and at
  68pt on the grid.
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

A tile is a squircle filled with the app's **tint**, carrying one **glyph** from the shell's own icon set in
the tint's on-fill colour. The generator picks both by name in `defineApp`:

```ts
export default defineApp({
  name: 'Pour Timer',
  tint: 'cocoa',      // one of 13 TintName values (01-direction §3.4)
  icon: 'timer',      // one of 147 IconName values (list below)
  initial: 'Home',
  screens: { Home },
  capabilities: ['cues'],
});
```

Why this one:

1. **Meaning beats letters.** People scan a home screen by shape and colour; a cup, a drop, a die are read
   before any label.
2. **Closed sets are what LLMs are good at.** Choosing "timer" from a list is a classification task. The
   names come from Lucide, which models have seen in thousands of React codebases, so the right name is
   usually the first one they think of.
3. **One family by construction.** Every glyph is drawn on the same grid with the same stroke; every tint
   was tuned for the same contrast. A grid of tiles made by a model on different days still looks designed.
4. **It costs nothing and is there from the first second,** so a tile being made can already show its
   final shape language.
5. **The same two tokens serve every surface:** the home tile, the 24pt tile in the Whim sheet and in
   History's header, the app's name in prose (tint text colour), and the app's own `primary` inside it.

`AppSpec.tileColor` is retired in favour of `tint`. Both are static literals the build extracts exactly as
it extracts `capabilities` today (`server/src/generation/stages/check.ts:40-64`), so there is still one
source of truth and nothing is executed to find them.

## Fallbacks and collisions

- **Missing or invalid `icon`:** the host picks a glyph from the app's name with a small keyword table
  (below). No match gives the name's first letter, set in `title2` bold, centred, as the glyph.
- **Missing or invalid `tint`:** a stable hash of the name chooses one of the 13 tints, the same idea as
  today's `appColor`.
- **Installed apps with a hex `tileColor`:** map to the nearest tint in OKLCH (greys to `graphite`,
  low-chroma browns to `cocoa`, ember-range orange to `red` or `yellow`, whichever is closer).
- **A copy of an app** keeps its glyph and takes the next tint in the ring, so the original and the copy
  differ at a glance. Its second line reads "Copy".
- **Two different apps landing on the same glyph and tint** is possible and fine; their names differ. Two
  apps with the same name (today's two "Hello App"s) get a different tint the same way a copy does.

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

147 glyphs from `lucide-static@0.460.0` (ISC licence, vendored as path data, attribution kept). Grouped here
for the generator's reference; the SDK exports the same list as the `IconName` union and `Icon` uses it too.

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
| Grid | 4 columns. Column width = (screen − 2 × 20) / 4. Tile = column × 0.74, rounded down to an even number: 64 at 390pt, 68 at 412dp. Row gap 20 between a label and the next tile. |
| Shape | Superellipse, corner 22.5% of the side, one SVG path on both platforms. No border, no gloss, no ghost letterform. |
| Fill | The tint's fill, the same in light and dark mode. |
| Glyph | 50% of the tile (32 at 64), centred, on-fill colour, stroke 2 in the 24-unit grid (2.7px rendered at 32). |
| Label | `caption` 12/16 weight 500, `text`, centred, one line, truncated with an ellipsis; the full name is in the context menu and the accessibility label. |
| Second line | Only for state: "Making…", "Didn't work", "Stopped", "Needs update", "Changing…", "Copy". `caption` in the role's text colour. Examples carry no "Example" line any more; their History says where they came from. |
| Touch | The whole column cell (tile + label) is one target, at least 64 × 84. |

## States

| State | Tile | Second line | Tap | Long-press menu |
|---|---|---|---|---|
| Ready | Tint + glyph | none | Opens the app (morph from the tile) | Open, Change it, History, Make a copy, Share link, Delete |
| Pressed | Scales to 0.96 on touch-down | | | Tile lifts to 1.06 with `shadow-floating` at the 350 ms threshold, haptic, menu grows from it |
| Being made | `ember-soft` squircle with the eyeless ember (40% of the tile) glowing with the stream (honest light) | "Making…" in `ember-text` | Opens the making view | Show progress, Stop making |
| Queued | Same, ember still and dim | "Waiting…" `text-2` | Opens the making view | Show progress, Stop |
| Failed | `fill` squircle, grey ember, 18pt danger badge with `circle-alert` at the top-right corner | "Didn't work" `danger-text` | Opens the failure view | See what happened, Try again, Discard |
| Stopped (the phone closed mid-make) | `fill` squircle, grey ember | "Stopped" `text-2` | Opens the failure view with "Try again" first | Try again, Discard |
| Needs update | `fill` squircle, grey ember | "Needs update" `warning-text` | Opens the update screen | Update Whim, Discard |
| Changing (a change in flight on an installed app) | The app's tile with a 2pt ember ring 3pt outside the squircle, glowing with the stream | "Changing…" `ember-text` | Opens the app (current version) | Show progress, Stop the change |
| Change failed | The app's tile with the danger badge | "Change didn't work" `danger-text` | Opens the app | See what happened, Try again, Discard the change |

The grey ember for failed and stopped tiles is the wisp's silhouette in `text-3` with no glow: Whim's mark,
with the light out. The name under a tile being made is a short working name: the name the plan response
proposes when it has one, otherwise the first three words of the description without a leading "A", "An" or
"The" ("Pomodoro timer", not "A Pomodoro timer", and not "A habit tracker: my…" as in `android/26b`).

When making finishes while the grid is on screen, the ember tile turns into the app's tile in place: the
glow flares (`spark`), the squircle fills with the tint from the centre out, and the glyph fades in at 0.9
scale and settles (`morph`). `05-motion.md` has the values.

## Accessibility

- Accessibility label: the name, then the state when there is one ("Pour Timer, making"). Hint: "Opens the
  app" or "Shows progress".
- The glyph is decorative to screen readers; the name carries the meaning.
- Every tint's on-fill colour clears 4.55:1 against its fill, more than the 3:1 a glyph needs.
- Increase Contrast adds a 1px `separator` outline to the squircle so light tints (`lime`, `yellow`) hold
  their edge on the light canvas.

## Choosing well: what the generator is told

The SDK reference gets one short section with both lists and four rules:

1. Pick the glyph for what the app is *about*, not what it looks like inside ("timer" for a pour-over timer,
   not "list-checks" for its steps).
2. Pick the tint for the feeling of the subject: warm tints (`red`, `pink`, `yellow`, `cocoa`) for food,
   home and play; cool ones (`blue`, `sky`, `teal`, `indigo`) for focus, health and money; `graphite` for
   tools.
3. Never pick a tint to mean a status. Red doesn't mean danger here; it means the app is red.
4. When changing an app, keep its glyph and tint unless the person asks for a new look.

The corpus eval gets a case that checks the pair is present, valid, and stable across a change.

## Not in v1

**Live tiles.** A tile that shows "5 of 8 glasses" is the most useful idea on the table and I want it later.
It isn't in v1 because an app only runs while it is open, so the tile would show whatever the app last said,
possibly yesterday's count. That breaks honest light unless the line carries its age ("5 of 8 · yesterday"),
and it needs a new app-to-host channel through the containment model. It belongs with background execution
(capability tier 2), where the app can keep its line current.

**Choosing your own tile.** A "Customize tile" row in the context menu, opening a sheet with the 13 tints and
a searchable glyph grid, stored host-side as an override that survives changes. Cheap and pleasant, but not
needed for the system to work; it goes in a later chain.
