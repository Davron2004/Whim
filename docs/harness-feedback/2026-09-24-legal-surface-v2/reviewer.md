# legal-surface-v2 reviewer (whole change) — harness feedback

- **What:** A draft paragraph deferred by one chain was dropped when the chain it waited on shipped (the D18 age paragraph, H1). **Mechanism:** chain block / contract (chain-7 deferred it "until age signals ship"; chain-9's scope listed only the review notes). **Verdict:** DRAWBACK (plan gap). **Cost:** found only at final review; a legal-text omission would have shipped. **Evidence:** `progress.md:34`; `draft-copy.md:265`.
- **What:** A shared constant made a per-language gate check unable to fail (M1). **Mechanism:** gate check design; the red-check changed `covers`, never the text. **Verdict:** DRAWBACK. **Evidence:** `copy.ts:396,422`; `disclosure.suite.ts:237`.
- **What:** The review range included another change's handoff files. **Mechanism:** per-run staging branch isolation. **Verdict:** NEUTRAL. **Cost:** 2 calls.
- **What:** A published retention claim depends on infrastructure no check reads (size-rotated Docker logs). **Mechanism:** the manifest keep-period check covers only server env variables. **Verdict:** DRAWBACK. **Cost:** found only at review; #85 filed but not tied to the deploy. **Evidence:** `deploy/compose.yaml:40-44`; `server/src/config.ts` `KEEP_PERIOD_CATEGORIES`.

**What helped:** the ledger's carried list and each chain's class-A notes; explicit "unverified" markers (the Gradle coordinate, iOS never answering `minor-not-approved`).

**What the harness should change:**
1. Every item a chain defers becomes a task in a named later chain or a ledger carry line; the dispatcher refuses a chain whose inputs include an unassigned deferral.
2. Per-language legal checks must be red-checked by changing the text itself, not adjacent metadata.
3. A "claims ledger" for legal text: each published retention/processing claim names its enforcing mechanism (code, config, infrastructure), and the reviewer checks each.
