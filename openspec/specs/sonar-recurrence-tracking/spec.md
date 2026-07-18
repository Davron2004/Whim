# sonar-recurrence-tracking

## Purpose

Created by syncing change `sonar-recurrence-ledger`. Tracks recurring SonarCloud
findings across fix rounds via an append-only ledger, surfaces recurrence-based
promotion candidates in the critic's report, and keeps promotion of a candidate
into a standing lint rule a human-ratified Class-1 change — never automated.

## Requirements

### Requirement: An append-only recurrence ledger records every external finding

The repo SHALL carry `openspec/critic/sonar-ledger.md`, an append-only ledger with one line per SonarCloud finding per fix round, in the form `- <YYYY-MM-DD> <run-id> <rule-id> <path>:<line>`, where `run-id` is the OpenSpec change id of the fix round and `rule-id` is the SonarCloud rule (e.g. `S2871`). Existing lines SHALL never be edited or removed. The file's header comment SHALL document the grammar and the append discipline. The ledger format SHALL NOT be the `fixloop.sh stale` evidence-file grammar.

#### Scenario: A Sonar fix round is transcribed

- **WHEN** SonarCloud findings are transcribed into a findings list for a fix round under change `<id>`
- **THEN** one ledger line per finding is appended with that change id as `run-id`, and no existing line is modified

#### Scenario: Re-run of the same round

- **WHEN** the same change's Sonar round is re-run and re-transcribed
- **THEN** appended lines reuse the same `run-id`, and recurrence counting treats them as one run

### Requirement: The critic reports recurrence-based promotion candidates

The critic's report SHALL include a `## Recurring external findings` section that (a) states the ledger's most recent append date, (b) groups ledger lines by rule id and counts distinct run-ids, and (c) lists every rule with ≥3 distinct run-ids as a promotion candidate — citing its recurrence lines and a suggested enforcement mechanism from the fixed menu (enable an existing `sonarjs` rule; `no-restricted-syntax` selector with instructional message; type-aware `@typescript-eslint` rule; local custom rule). Rules at exactly 2 distinct runs MAY be listed as "watch". The threshold SHALL be stated in the section so a human can tune it. The critic SHALL NOT write to the ledger or to any lint config — candidates are proposals only.

#### Scenario: A rule crosses the threshold

- **WHEN** the ledger shows the same rule id under 3 distinct run-ids at critic time
- **THEN** the critic report lists it as a promotion candidate with its recurrence evidence and one suggested mechanism

#### Scenario: Ledger is stale during active Sonar work

- **WHEN** the critic runs and the ledger's last append predates known recent Sonar fix rounds
- **THEN** the section reports the stale date, making the skipped append itself visible

### Requirement: Promotion remains a human-ratified Class-1 change

Acting on a promotion candidate SHALL be a separate change that edits `.eslintrc.js` (or adds an equivalent rule), ratified by a human under the fix-vs-relax checklist as a check-strengthening edit. No agent or hook SHALL apply a promotion automatically from the ledger or the critic report.

#### Scenario: Candidate is promoted

- **WHEN** a human accepts a promotion candidate
- **THEN** the lint-config edit lands as its own human-ratified change, and subsequent recurrences of that rule are caught by the fast gate's lint step in the inner loop

### Requirement: The ledger never breaks critic report scoping

The critic-run scoping rule SHALL select the newest **date-named** (`YYYY-MM-DD.md`) file in `openspec/critic/` as the last report; non-date-named siblings (the ledger, README) SHALL be ignored by scoping. `openspec/critic/README.md` SHALL document both the ledger and this scoping rule.

#### Scenario: Ledger appended after the last report

- **WHEN** the ledger is the most recently modified file in `openspec/critic/` and a critic run starts
- **THEN** scoping still resolves "since the last report" to the newest date-named report file
