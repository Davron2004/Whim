## ADDED Requirements

### Requirement: Every server record keyed by a phone ID has a keep-period
Every server record keyed by a device ID SHALL be deleted within its disclosure-manifest category's published maximum. Reports and ledger rows SHALL be purged by age as today. The lifetime `usage` table SHALL record the UTC day each row was last credited, SHALL set it on every credit, and SHALL delete rows not credited for more than the configured idle period, which defaults to 365 days. The migration that adds the column SHALL be idempotent and SHALL set existing rows to the day it runs.

#### Scenario: An idle phone's totals are purged
- **WHEN** a device's usage row was last credited 366 days ago and the daily purge runs
- **THEN** the row is gone

#### Scenario: An active phone keeps its lifetime totals
- **WHEN** a device's usage row was credited yesterday and the daily purge runs
- **THEN** the row and its running totals are unchanged

#### Scenario: The migration is safe to rerun
- **WHEN** the server starts twice on a database created before this change
- **THEN** the column exists once, every pre-existing row has a last-credited day, and no totals changed

### Requirement: A configured keep-period never exceeds its published maximum
Server config parsing SHALL refuse to start when any configured keep-period exceeds the published maximum that the current disclosure manifest gives its category: report retention, ledger retention, usage idle period, or log retention the server controls. The deploy check SHALL run the same parse against the deploy's environment and SHALL fail on the same condition.

#### Scenario: Too long a report retention refuses to start
- **WHEN** `WHIM_REPORT_RETENTION_DAYS` is set to 400 and the manifest's maximum for reports is 365 days
- **THEN** the server exits at startup naming the variable and the maximum

#### Scenario: A shorter setting is fine
- **WHEN** `WHIM_LEDGER_RETENTION_DAYS` is 90 and the manifest's maximum for usage records is 365 days
- **THEN** the server starts

### Requirement: The operator can export and delete one phone ID's records
`whim-admin device export <id>` SHALL print one JSON object holding every server record keyed by that device ID: its reports, its ledger rows, and its usage row. `whim-admin device delete <id>` SHALL delete all of them and print how many of each it removed. Both SHALL succeed with empty results for an unknown ID. Any record type later keyed by device ID SHALL join both subcommands in the change that adds it.

#### Scenario: Export finds everything
- **WHEN** a device has two reports, five ledger rows and a usage row, and the operator runs `device export` for it
- **THEN** the output holds exactly those records

#### Scenario: Delete removes everything and is idempotent
- **WHEN** the operator runs `device delete` for that device twice
- **THEN** the first run reports 2, 5 and 1 removed, a following export is empty, and the second run reports zero of each
