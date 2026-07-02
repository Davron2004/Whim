# Whim — App Corpus (target list, eval seed)

*The §18 artifact: the concrete apps Whim exists to make possible. Authored by the user
(2026-06-11 planning session, decision #42). The **Tier-0 rows are the v1 corpus** — they size
the SDK (gap analysis) and seed the eval prompts. Change `tier0-corpus-and-sdk-gap` expands
this into the per-app SDK breakdown; until then this table is the source of truth.*

| Tier | App | What it uniquely pulls |
|------|-----|------------------------|
| 0 | tip splitter ✅ | (shipped — zero syscalls) |
| 0 | spending tracker + graph | Chart (bar/line), SegmentedControl, record collections, date bucketing |
| 0 | habit tracker w/ streaks | date math, calendar heatmap (a second chart shape) |
| 0 | water / calorie counter | "new day" reset semantics, big-tap UX |
| 0 | workout log | nested forms (exercise → sets), history views |
| 0 | flashcards w/ spaced repetition | card flip (instant in v1 — animation deferred), date-based scheduling without notifications |
| 0 | board-game score keeper | dynamic entity lists (add/remove players) |
| 0 | packing checklist w/ templates | bulk state ops, instantiate-from-template |
| 0 | recipe box | text-heavy CRUD, search/filter over storage |
| 0 | tic-tac-toe | grid layout, turn-based state — proves "games ≠ canvas" |
| 0 | chore rotation roulette (no spin yet) | rotation/modular logic, multi-person data |
| 1 | meal-plan generator (phase 1) | ai.complete with structured output (schema'd JSON, not prose) |
| 1 | journal w/ weekly AI summary | AI over accumulated stored data (read-many → summarize) |
| 1 | fridge-to-recipe | AI as the whole app, trivial UI |
| 2 | meal-plan alarm (full version) | scheduled notifications w/ pre-baked content |
| 2 | pour-over timer | interval effects + haptics — **foreground version is the v0.3 fixture** (effects-and-cues); the background/alarm version is the Tier-2 app |
| 2 | medication / plant reminders | recurring schedules, per-entity timers |
| 3a | weather day-picker ("bike or train today?") | first curated integration |
| B-anim | drinking roulette | declarative motion (post-v1 animation tier), randomness + ceremony |
| 5 | Tetris / 2048 | canvas, frame loop, gestures — the far end, on purpose |

## Notes pinned at authoring time (decision #42)

- **Chart is its own OpenSpec change** (`sdk-charts`): the corpus needs exactly three shapes —
  bar, line, calendar-heatmap. Declarative, data-as-props, tokens-only. No pie/scatter,
  no tooltips/pan/zoom, no animation, no canvas in v1.
- **Animation/motion is one coherent post-v1 tier**, not per-app hacks: the flashcard flip is
  instant (or a trivial CSS cross-fade) in v1; the drinking-roulette ceremony waits for the tier.
- **Pour-over timer splits across tiers**: foreground (interval + haptic/audio cue while the app
  is open) lands at v0.3 as the `effects-and-cues` fixture; "fires when the app is closed" is Tier 2.
- **Gap to verify in `tier0-corpus-and-sdk-gap`**: recipe-box search may need a text-`contains`
  filter the storage engine's `where` (equality + gt/gte/lt/lte, AND-only) doesn't have — if so,
  that's a small *additive* engine verb option, flagged early on purpose.
- **Eval seeds**: each Tier-0 app gets 2–3 prompt phrasings; the visible set lives in the repo,
  the **held-out set stays with the user, never committed** (§16.4).
