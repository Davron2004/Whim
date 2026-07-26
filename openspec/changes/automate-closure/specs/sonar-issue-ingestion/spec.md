# sonar-issue-ingestion

## ADDED Requirements

### Requirement: Sonar findings for a PR are retrieved programmatically in fix-loop format

A repo script (Node; `curl` remains policy-denied) SHALL retrieve, for a given pull request: all open issues (`api/issues/search`, `resolved=false`, paged to completion) and the quality-gate status (`api/qualitygates/project_status`) from the SonarCloud Web API, authenticating with `Authorization: Bearer $SONAR_TOKEN`. It SHALL emit the issues in the fix-loop findings-file format (rule key, message, file, line, severity per finding) plus a machine-readable quality-gate verdict, so its output feeds the existing `findings.md` → `plan.md` → `dispositions.md` flow and the sonar-ledger transcription unchanged. The GitHub check-run side SHALL NOT be used as the issue source (it is lossy: new-code-only, annotation caps, no rule keys); it MAY be used only as the poll trigger and pass/fail verdict.

#### Scenario: Sonar round ingestion

- **WHEN** the closure pipeline detects a red quality gate on the staging-branch PR
- **THEN** the script's output is written as the round's findings list and the nested fix-loop is dispatched from it, with no human transcription step

#### Scenario: Pagination beyond one page

- **WHEN** the PR has more open issues than one API page returns
- **THEN** the script pages until exhaustion and the findings list contains every open issue

### Requirement: Authorization visibility is verified before any result is trusted

Because `api/issues/search` returns HTTP 200 with `total: 0` for a project the token cannot see, the script SHALL first verify visibility via `api/components/show` for the project key — which returns 404 when unauthorized — and SHALL hard-fail with a distinct error before reporting any issue list or gate status when that check fails. An empty findings list SHALL be reportable only after the visibility check has passed.

#### Scenario: Missing or revoked token

- **WHEN** the script runs with `SONAR_TOKEN` unset, invalid, or lacking access to the project
- **THEN** it exits non-zero with an auth-visibility error and produces no findings output, rather than reporting a clean gate

#### Scenario: Genuinely clean gate

- **WHEN** the visibility check passes and the PR has zero open issues and a green gate
- **THEN** the script reports an empty findings list and a green verdict

### Requirement: Ingestion is advisory; the server-side quality gate remains the enforcement

The script SHALL NOT be part of the protected gate surface. The PR's server-side SonarCloud quality-gate check SHALL remain the merge-blocking enforcement, so a tampered or wrong ingestion result can waste a fix round but cannot cause an unclean merge.

#### Scenario: Tampered ingestion output

- **WHEN** the script under-reports issues for a PR whose server-side quality gate is red
- **THEN** the PR's required check stays red and the closure pipeline cannot flip the PR to ready-for-review on a green-gate condition
