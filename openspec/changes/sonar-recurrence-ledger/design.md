# Design: sonar-recurrence-ledger

## Context

The shift-left pipeline for external findings has every stage built except memory: SonarCloud discovers (PR-time, server-side, no local runner — research.md quotes harness.md:99), fix rounds repair, `.eslintrc.js` + `plugin:sonarjs/recommended-legacy` enforce promoted rules in the inner loop, and `.eslintrc.js` already holds one successfully promoted rule (the bare-`.sort()` selector). What's missing is the record connecting the stages: Sonar rule/finding ids currently appear only as prose inside per-change folders (research.md: `fix-sonarjs-gate` findings list, `clear-sonarqube-warnings` research), never anywhere durable, so recurrence is invisible and promotion has no trigger.

## Goals / Non-Goals

**Goals:**
- Every Sonar fix round leaves one greppable ledger line per finding, at near-zero process cost.
- The critic surfaces promotion candidates from data (≥N distinct runs), with a concrete suggested mechanism per candidate.
- Human stays the ratifier of every promotion (Class-1 `.eslintrc.js` edits).

**Non-Goals:**
- Automated SonarCloud ingestion (API/gh tooling) — today's human-transcription workflow is kept; automation is a separate future change once the staging-branch lane settles.
- Performing promotions — each is its own later change; this change only makes candidates visible.
- Extending `fixloop.sh` or its `stale` evidence grammar — the ledger is a new artifact, not a fix-loop input.
- Tracking *local* lint findings — those already fail the inner loop; the ledger records only external (SonarCloud) findings, whose discovery is expensive.

## Decisions

1. **Location: `openspec/critic/sonar-ledger.md`.** The critic's read scope covers it for free, and `openspec/critic/` is the repo's one established "durable, git-tracked, dated" convention (research.md). Alternative rejected: `docs/` — the ledger is harness state consumed by an agent, not project history for humans; `docs/decisions.md`/`DEVLOG.md` stay the narrative layer.

2. **Scoping collision fixed by tightening the rule, not renaming the file.** `critic-run.md`'s "newest file in `openspec/critic/`" heuristic would resolve to a freshly-appended ledger (research.md constraint). The scoping rule becomes "newest **date-named** (`YYYY-MM-DD.md`) file"; README documents it. This also future-proofs against any other non-dated sibling. Alternative rejected: hiding the ledger elsewhere to preserve the naive heuristic — spreads critic inputs across subsystems.

3. **Line format: `- <YYYY-MM-DD> <run-id> <rule-id> <path>:<line>`** — append-only, one line per finding, no sections, header comment documents the grammar. `run-id` = the OpenSpec change id of the fix round (research.md open question resolved: change ids are the repo's existing unit of "a round of work", already used by dispositions and archives; batch ids and SHAs are less stable across archiving). Rule id in SonarCloud form (`S2871`) with the `sonarjs/...` alias noted when known. Rationale: greppable with one `grep <rule-id> | cut`, diff-friendly, and deliberately *not* the `fixloop.sh stale` evidence grammar (`## <path>` headers) so the two artifacts can never be confused (research.md constraint).

4. **The appender is the findings transcriber.** The workflow step that today turns SonarCloud PR results into a findings list (human-directed, per the `clear-sonarqube-warnings` precedent) gains one instruction: also append the ledger lines. No hook enforces it — the critic's section header notes the last ledger date, so a silently skipped append is visible in the next critic report rather than silently lost. Alternative rejected: a fix-loop step in `fix-loop.md` — not every Sonar round runs through the fix loop, and the transcription moment is where rule ids are already in hand.

5. **Promotion threshold: ≥3 distinct run-ids, advisory.** The critic lists candidates at ≥3, may flag a ≥2 rule as "watch", and the threshold is stated in the critic section itself so a human can tune it by editing one line. Distinct *runs*, not raw finding count — 10 hits in one round is one generation habit, 3 hits across 3 rounds is a recurring one.

6. **Candidate entries carry a suggested mechanism, chosen from a fixed menu** (cheapest first): enable an existing `sonarjs` rule not in `recommended-legacy`; a `no-restricted-syntax` selector + instructional message (the proven `.sort()` pattern); a type-aware `@typescript-eslint` rule when the untyped selector over/under-matches; a local custom rule as last resort. The critic recommends, citing the recurrence lines; the promotion itself is a later human-ratified Class-1 change (fix-vs-relax: check-*strengthening*, ratified for false-positive cost, not tamper risk).

7. **Critic stays read-only.** It reads the ledger and writes only its own dated report (research.md invariant: "never fixes anything"; its tool set needs no additions). `critic-run.md` passes the ledger path alongside the scope ref.

## Risks / Trade-offs

- [Manual append gets skipped] → visibility mitigation (Decision 4): the critic section reports the ledger's last-append date every run; a stale date during active Sonar work is itself a finding.
- [Ledger mistaken for the newest critic report] → Decision 2 fixes the scoping rule in the same change that introduces the file; README documents both together.
- [run-id ambiguity when a round spans changes or reruns] → convention: the change id under which the findings list lives; a re-run of the same change appends under the same id and counts once (distinct-run counting).
- [Backfill misrepresents history] → backfill only from findings lists that exist verbatim in the repo (the two known rounds), marked with a `backfilled` suffix comment; no reconstruction from memory.
- [Threshold too low/high] → advisory-only output; nothing automatic hangs off the number, and it's tunable in one line.

## Open Questions

- None blocking. If the staging-branch-integration change lands first, the transcription step it defines (Sonar iteration on the draft PR) is where the append instruction naturally lives; the ledger format and critic section are independent of which integration lane is active.
