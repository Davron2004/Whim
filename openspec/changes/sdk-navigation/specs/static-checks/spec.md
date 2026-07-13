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
Future navigation shapes continue to land as data updates, not checker changes.

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

#### Scenario: Unresolvable initial

- **WHEN** `initial: 'Hom'` does not match any `screens` key
- **THEN** the report contains an error diagnostic with a hint listing the declared screens
