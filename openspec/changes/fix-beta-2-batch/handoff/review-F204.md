# Review: F204 (`fix/F204` @ 5083db92)

Reviewer: Opus, effort high, 2026-10-30. Saved by the integration orchestrator.

VERDICT: reject (one stale doc comment). The move matches DONE (FirstRunSheet.tsx:219-221, JSX byte-identical apart from position; footer share untouched; gaps only from `LAYOUT.gapBetweenGroups` = 24, tokens.ts:277; nothing doubled/lost at boundaries); the test reads real render order in en/fr with ≥0 guards and a real press; system.md §9 + mockup edits limited and consistent; a11y order title → lead → Language → summary (no header separated); nothing removed; handoff honest.

## MEDIUM
1. FirstRunSheet.tsx:4-8 header comment still lists the old order (Language last). Done: it reads title, lead, Language row (one-tap switch …), three summary rows, Privacy policy, Full details, then the pinned terms row and the two actions.

## LOW
2. terms-flow-ui.suite.tsx:416 message "the Language row above it" assumed Language was the last body row; optional rewording, e.g. "as a list row (the Language row) does".
