# Whim — Tier-0 SDK Gap Analysis & Eval Seeds

*Deliverable of roadmap change #1 `tier0-corpus-and-sdk-gap` (executed 2026-06-12 as a
working session with the user; see `docs/v1-roadmap.md` ledger). Inputs: `docs/app-corpus.md`
(the 11 Tier-0 apps) and the SDK/engine surface as verified on disk this date. This file is
the scope contract for `sdk-design-system` (#3) and `sdk-charts` (#4), and the seed for
`eval-harness` (#12).*

## 1. Current surface (verified on disk, 2026-06-12)

- **Components (7):** `Screen`, `Stack`, `Row`, `Text`, `Heading`, `NumberInput`, `Button`.
- **Hooks:** `useState`, `useEffect` only.
- **App/system:** `defineApp` (screens map + `schema` + `capabilities`), `storage` facade
  (kv + records, via the bridge), design tokens (space ·radius · color ·text-size · weight).
- **NOT present:** navigation (`defineApp` takes a `screens` map but there is no
  `useNavigation`/`nav.push` — every fixture is single-screen), `useMemo`/`useCallback`/
  `useReducer`, every input beyond NumberInput, all display/overlay components, charts.
- **Storage `where` grammar:** per-field equality or range (`gt/gte/lt/lte`), AND-only,
  `orderBy`/`limit`/`offset`. **No text-`contains`**, and **no batch verb** (each write is
  its own transaction — by design, #40).

## 2. Resolved judgment calls (user, 2026-06-12)

1. **Search = client-side filter pattern.** Load the collection into state, filter in JS as
   you type — Layer-1, fine at personal scale (full 2000-row `list` ≈ 4–11 ms on-device).
   The SDK reference teaches this as *the* search idiom. A `contains` op stays a known
   additive engine upgrade, **not in v1**.
2. **DatePicker wraps the DOM's native `<input type="date">`** — Android's native date
   dialog for free inside the WebView; token-styled trigger.
3. **Overlays: `Alert` (destructive confirm) + `Toast` (transient feedback) only.**
   Modal/Sheet/Menu deferred — every corpus add/edit flow is a pushed screen.
4. **Icons: closed named set (~16–20 names)** as `Icon` + `IconButton`, inline SVG.
   Unknown name = structured error (hallucination-proof by construction).

## 3. Per-app breakdown (the 11 Tier-0 corpus apps)

Bold = does not exist yet. Storage column gives the intended schema shape (engine types).

| App | Screens | Components | Storage | Notes |
|---|---|---|---|---|
| Tip splitter ✅ | 1 | existing set | none | shipped fixture |
| Spending tracker + graph | Home · Add/Edit | **Chart(bar,line)**, **SegmentedControl**, **List**, **TextInput**, **Picker**(category), **DatePicker**, NumberInput, **Card**, **EmptyState**, **Alert**, **Toast**, **Icon/IconButton**, **nav** | records `expenses {amount:float, category:text, note:text, spentAt:date}`; kv settings | date bucketing = Layer-1 JS |
| Habit tracker w/ streaks | Home · Detail · Add | **Chart(heatmap)**, **List**, **Checkbox**, **Badge**(streak), **TextInput**, **EmptyState**, **Alert**, **nav** | records `habits {name:text}` + `checks {habitId:text, day:date}` | cross-collection ref = id stored as `text`; streak math Layer-1 |
| Water / calorie counter | 1–2 | Button **size=lg** (big-tap), **ProgressBar**, Text `display` | kv `today` + records `days {day:date, total:int}` | "new day" reset = Layer-1 date compare on mount |
| Workout log | Home · Log · Detail | **List**, **TextInput**, NumberInput, **IconButton**(remove row), **Card**, **Divider**, **EmptyState**, **nav** | records `workouts {day:date, title:text, exercises:json}` | nested sets live in a `json` field — see §4 modeling rule |
| Flashcards w/ spaced rep | Decks · Review · Add | **Card**(tap-flip, instant), **TextArea**, **List**, **ProgressBar**, **nav** | records `cards {front:text, back:text, due:date, intervalDays:float, ease:float}` | review queue = `where due lte now, orderBy due`; SM-2 math Layer-1 |
| Board-game score keeper | 1–2 | **List**, **IconButton**, **TextInput**, +/- Buttons, **Badge** | records `players {name:text, score:int}` | dynamic add/remove entities |
| Packing checklist w/ templates | Lists · Detail · Templates | **Checkbox**, **List**, **Picker**(template), **TextInput**, **EmptyState**, **Toast**, **nav** | records `templates {name:text, items:json}` + `lists {name:text, items:json}` | items-as-json makes "uncheck all"/instantiate one write (no batch verb exists) |
| Recipe box | Home · Recipe · Add/Edit | **TextInput**(search), **TextArea**, **List**, **Card**, **Badge**(tags), **EmptyState**, **Alert**, **nav** | records `recipes {title:text, ingredients:text, steps:text, tags:text}` | search = client-side filter (§2.1) |
| Tic-tac-toe | 1 | **Grid**(3×3 of Buttons), Text, Button | kv `tally {x:int, o:int, draws:int}` (optional) | turn logic Layer-1 — proves "games ≠ canvas" |
| Chore rotation roulette | 1–2 | **List**, **Card**(result), **TextInput**, **IconButton**, **Toast** | records `people {name:text}`; kv `rotation {idx:int, lastAt:date}` | rotation = Layer-1 modular math; no spin animation (post-v1) |

## 4. Consolidated gaps → change assignments

**→ #3 `sdk-design-system`:**
- **Navigation (the biggest single gap):** `useNavigation` (`push/back/replace`) + `useRoute`
  over the `defineApp` screens map. ⚠️ **Coordination contract with #5 `launcher-shell`:**
  system back must pop the mini-app nav stack before exiting — the host needs a nav-depth
  seam (control frame or host-mirrored depth). Whichever proposal lands first defines it;
  the other consumes it.
- Inputs: `TextInput`, `TextArea`, `Checkbox`, `Toggle`, `Picker`, `DatePicker` (native
  `<input type="date">` wrapper), `Slider`, `SegmentedControl` (the latter two existed in
  spike code only — re-add as retained components).
- Display: `Card`, `List`, `ListItem`, `Icon` (closed set), `IconButton`, `Divider`,
  `Badge`, `ProgressBar`, `EmptyState`; layout `Grid`, `Spacer`.
- Overlays: `Alert`, `Toast` (only).
- Hooks: re-export `useMemo`, `useCallback`, `useReducer`.
- Tokens: add `success` + `warning` colors; `Button` gains `variant` (primary/secondary/
  danger) and `size` (sm/md/lg — the big-tap case); dark-mode token remap.
- **SDK reference doc** must teach: the client-side search idiom; the **json-vs-collection
  rule** (entities you list/filter/update independently → own collection; data that lives
  and dies with its parent → `json` field — also the no-batch-verb workaround); cross-
  collection refs as stored-id `text` fields.

**→ #4 `sdk-charts`:** one `Chart` export, `kind: 'bar' | 'line' | 'heatmap'` (single doc
entry is the model-friendly shape; final call in #4's design). Exactly these three kinds.

**→ #2 `effects-and-cues`** (already in flight): `delay`, `interval`, haptics, audio cues —
no corpus app needs more than that (pour-over is the v0.3 fixture, not corpus).

**→ engine:** **nothing for v1.** `contains` deferred (§2.1); batch verb still not needed.

## 5. The v1 export count: **~42** (ceiling was 60–80)

29 components (the 7 existing + 20 from §4 + `Chart` + `Grid`/`Spacer` counted above) +
`defineApp` + `storage` + 5 hooks + 2 nav + 2 effects + 2 cues = **42**. Every export traces
to a corpus app above; nothing speculative. The ceiling discipline held with room to spare.

## 6. Eval prompt seeds — VISIBLE set (2 per app, casual voice)

1. *Tip splitter:* "make a tip calculator that splits the bill between friends" · "I enter the bill, pick a tip percent, and see what each person owes"
2. *Spending:* "track my spending and show me a weekly graph" · "an expense tracker with categories and a chart of where my money goes each month"
3. *Habits:* "habit tracker with streaks — show a calendar of the days I did it" · "track a few daily habits and show my current streak for each"
4. *Water/calories:* "a water counter — one big button to log a glass, today's total vs my goal" · "count my calories today with a progress bar toward my daily limit, keep history"
5. *Workout:* "a workout log — each session has exercises with sets, reps and weight" · "log my gym workouts and let me look back at what I lifted last time"
6. *Flashcards:* "flashcards with spaced repetition — show me the cards due today" · "I make flashcards and review them; ones I get wrong come back sooner"
7. *Score keeper:* "score keeper for board game night — add players and bump their scores" · "keep score for games, plus and minus buttons per player"
8. *Packing:* "packing checklist with templates — I make a 'beach trip' template and reuse it" · "checklist app where I save a list as a template and start a new trip from it"
9. *Recipes:* "a recipe box — save recipes with ingredients and steps, search by name" · "store my recipes and filter them by a tag like 'quick'"
10. *Tic-tac-toe:* "tic-tac-toe for two people on one phone" · "tic-tac-toe that keeps a running tally of wins"
11. *Chores:* "chore rotation — it tells us whose turn it is to do dishes and rotates fairly" · "rotate chores between roommates and remember who did what last"

## 7. Holdout protocol (§16.4 — outside the repo, NEVER committed)

The holdout set **exists** (authored 2026-06-12 in the planning session, extendable by the
user): fresh phrasings of the apps above plus novel Tier-0 apps not in the visible set, with
English expectations for scoring. **Its location is deliberately not recorded anywhere in
this repo** — the user supplies it to #12's eval runner at runtime via local, gitignored
config. Implementing and prompt/SDK-tuning sessions must not seek it out, and its contents
are never quoted into the repo, prompts, fixtures, or agent memory. Visible-vs-holdout
divergence = overfitting alarm.
