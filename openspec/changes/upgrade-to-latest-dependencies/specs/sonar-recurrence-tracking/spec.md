## MODIFIED Requirements

### Requirement: Promotion remains a human-ratified Class-1 change

Acting on a promotion candidate SHALL be a separate change that edits `eslint.config.mjs` (or adds an equivalent rule), ratified by a human under the fix-vs-relax checklist as a check-strengthening edit. No agent or hook SHALL apply a promotion automatically from the ledger or the critic report.

#### Scenario: Candidate is promoted

- **WHEN** a human accepts a promotion candidate
- **THEN** the lint-config edit lands as its own human-ratified change, and subsequent recurrences of that rule are caught by the fast gate's lint step in the inner loop
