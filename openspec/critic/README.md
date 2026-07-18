# Critic reports

Daily cold-read findings from the `critic` subagent, one file per run: `<YYYY-MM-DD>.md`.
Produced by `/critic-run` (see `.claude/commands/critic-run.md`), which scopes the critic to
everything since the newest **date-named** report here — a file matching `YYYY-MM-DD.md`
exactly. Other files in this directory (e.g. `sonar-ledger.md`) are never candidates for
"newest report": a naive lexical-newest sort would otherwise pick a non-date filename over
a genuinely newer dated report. The critic finds and documents problems — it never fixes
anything. You triage: trivial fixes by hand, real findings into an OpenSpec change,
"patterns worth a tripwire" into `scripts/gate.sh` by your own hand (agents are hook-blocked
from editing the gate).

This directory is intentionally kept in git so the "since the last report" marker survives.

## SonarCloud recurrence ledger

`sonar-ledger.md` is an append-only log of every external SonarCloud finding, one line per
finding per fix round (see its header comment for the exact grammar and run-id convention).
Whoever closes a SonarCloud fix round (a `whim-fixloop` change addressing external findings)
appends the round's lines before archiving the change. The critic reads it during a run to
spot rules/locations recurring across ≥3 distinct fix-round run-ids — a repeat-offender
candidate for human-ratified promotion into `.eslintrc.js`, after which the fast gate's lint
catches the recurrence in the inner loop instead of waiting for the next external round.
