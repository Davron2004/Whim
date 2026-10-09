## MODIFIED Requirements

### Requirement: Imports resolve only to vc-sdk

Every module specifier in a candidate SHALL be exactly `vc-sdk` (the #37 emit contract), wherever the specifier appears: an import declaration, a re-export (`export … from '<specifier>'`, `export * from '<specifier>'`), or an import-equals declaration (`import x = require('<specifier>')`).

Any other specifier in any of those positions, any `require(...)` call, and any dynamic `import(...)` SHALL each produce an error diagnostic whose hint names the allowed import.

#### Scenario: Off-allowlist import

- **WHEN** the source contains `import x from 'lodash'` (or `react`, `react/jsx-runtime`,
  a relative path, or a subpath like `vc-sdk/ui`)
- **THEN** the report contains an error diagnostic identifying the specifier and a hint
  pointing at `vc-sdk`

#### Scenario: Dynamic import

- **WHEN** the source contains `await import('vc-sdk')`
- **THEN** the report contains an error diagnostic (dynamic import is rejected regardless of
  specifier)

#### Scenario: A re-export of a file path is rejected

- **WHEN** the source contains `export * from '/etc/hosts'` or `export { x } from '../../server/src/main'`
- **THEN** the report contains an error diagnostic identifying the specifier, and the candidate never reaches the build stage

#### Scenario: An import-equals require is rejected

- **WHEN** the source contains `import cfg = require('./config.json')`
- **THEN** the report contains an error diagnostic identifying the specifier
