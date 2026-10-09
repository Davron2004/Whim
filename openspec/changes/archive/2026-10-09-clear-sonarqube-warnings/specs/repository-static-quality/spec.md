# repository-static-quality Specification

## Purpose

Keep the repository’s authored source and tooling code clean under the SonarQube Cloud analysis used by GitHub.

## ADDED Requirements

### Requirement: Authored repository code is SonarQube-clean

Repository source, build tooling, hooks, tests, and checked-in support code SHALL produce no open SonarQube findings after analysis, except for the explicitly documented opaque-origin `postMessage` finding in `src/sdk/navigation.tsx`.

#### Scenario: Non-exception findings are removed

- **WHEN** SonarQube Cloud analyzes the repository’s current new-code period
- **THEN** every finding other than the documented navigation exception is resolved by a semantics-preserving source change

#### Scenario: Navigation exception remains justified

- **WHEN** SonarQube analyzes the opaque sandbox child’s navigation-depth `postMessage`
- **THEN** the `'*'` target remains intact, the explanatory `NOSONAR` comment is immediately above the reported call, and outer-frame source verification remains the trust boundary

### Requirement: Static-quality cleanup does not weaken project protections

The cleanup SHALL NOT alter protected gate configuration, Sonar rule configuration, sandbox CSP/origin containment, capability authority, or generated-app diagnostic policy merely to suppress findings.

#### Scenario: Gates remain authoritative

- **WHEN** the cleanup is complete
- **THEN** the repository fast and full gates run with their existing configuration and pass without a new suppression mechanism
