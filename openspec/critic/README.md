# Critic reports

Daily cold-read findings from the `critic` subagent, one file per run: `<YYYY-MM-DD>.md`.
Produced by `/critic-run` (see `.claude/commands/critic-run.md`), which scopes the critic to
everything since the newest report here. The critic finds and documents problems — it never
fixes anything. You triage: trivial fixes by hand, real findings into an OpenSpec change,
"patterns worth a tripwire" into `scripts/gate.sh` by your own hand (agents are hook-blocked
from editing the gate).

This directory is intentionally kept in git so the "since the last report" marker survives.
