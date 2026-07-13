# static-checks Delta Specification

## MODIFIED Requirements

### Requirement: Screen graph resolves statically

The pipeline SHALL verify that `initial` names a key of `screens`. Navigation-target
resolution SHALL be table-driven data: for every recognized navigation call shape, a
string-literal target must name a declared screen, and a target that is not a string
literal SHALL produce an error diagnostic (the same conservative policy as computed global
access: the static answer to an undecidable target is "don't write that"). The shipped
shapes table SHALL contain the row `{object: 'nav', method: 'navigate', argIndex: 0}`
(the `sdk-navigation` surface); `nav.back()` takes no target argument and has no row.
The row's `object` names a `vc-sdk` export, not a textual source identifier: the checker
SHALL recognize direct imports, renamed imports, and namespace-qualified access, and SHALL
ignore unrelated local or shadowed bindings with the same spelling. Future navigation shapes
continue to land as data updates, not checker changes.

#### Scenario: Dangling nav target

- **WHEN** a mini-app source contains `nav.navigate('Settings')` and `'Settings'` names no
  `screens` key
- **THEN** the report contains an error diagnostic naming the unresolved target and listing
  the declared screens in its hint

#### Scenario: Non-literal nav target

- **WHEN** a mini-app source contains `nav.navigate(screenVar)` where the target argument is
  not a string literal
- **THEN** the report contains an error diagnostic applying the conservative policy (the
  static answer to an undecidable target is "don't write that")

#### Scenario: Aliased and namespace nav imports

- **WHEN** a mini-app calls either an aliased `vc-sdk` nav import or `sdk.nav.navigate(...)`
  through a `vc-sdk` namespace import
- **THEN** literal and non-literal target validation is identical to direct `nav.navigate(...)`

#### Scenario: Honest local nav shadow

- **WHEN** a local or parameter binding named `nav` is unrelated to the `vc-sdk` export
- **THEN** its method calls do not produce navigation-target diagnostics

#### Scenario: Unresolvable initial

- **WHEN** `initial: 'Hom'` does not match any `screens` key
- **THEN** the report contains an error diagnostic with a hint listing the declared screens
