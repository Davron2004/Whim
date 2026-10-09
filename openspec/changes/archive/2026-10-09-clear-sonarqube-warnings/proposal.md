## Why

SonarQube Cloud reports a failing new-code quality gate for the repository even though the local SonarJS mirror is clean. The remaining findings are static-analysis issues in repository tooling and source files; they should be corrected so the external gate returns to the project’s zero-warning state while preserving the one documented opaque-origin navigation exception.

## What Changes

- Fix all currently reported SonarQube findings outside the explicitly justified `src/sdk/navigation.tsx` `NOSONAR` case.
- Preserve the existing explanatory navigation suppression and its runtime behavior.
- Regenerate required build artifacts from source where applicable.
- Verify the cleanup with the repository gates and the resulting Sonar-compatible static checks.

## Capabilities

### New Capabilities

- `repository-static-quality`: Keep repository source and tooling free of SonarQube findings, with only the documented opaque-origin navigation exception.

### Modified Capabilities

None. This is a code-quality cleanup and does not change product runtime requirements or public APIs.

## Impact

The change may touch shell hooks, build tooling, runtime-support code, and test/helper files identified by SonarQube. It must not change sandbox authority, navigation semantics, generated-app diagnostics policy, protected harness configuration, or the existing dirty navigation edit.
