# developer-observability fix-4 (implementer) — harness feedback

- **What:** The chain block said to find the category list in `server/src/policy/`; it exists only as markdown in `docs/content-policy.md` (loaded via `generation/prompts/inputs.ts`), so a parser was added. **Mechanism:** chain problem-statement pointer (T1). **Verdict:** NEUTRAL. **Cost:** ~10 min.
- **What:** Case-insensitive matching had to be inferred from an existing test fixture's casing. **Mechanism:** test fixture as implicit spec. **Verdict:** NEUTRAL. **Cost:** ~5 min.

**What helped:** the exact repro scenario in the block; `captureLogs()`/`withMessage()` helpers.

**What the harness should change:**
1. Grep-verify "find X in <dir>" claims before dispatch.

Side finding: `docs/capabilities.md` points `content-policy` at `openspec/specs/content-policy/spec.md`, which doesn't exist (only under the unarchived `public-generation-server` change).
