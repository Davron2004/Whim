# Review: piece 236 (Opus medium, shift 4) — ACCEPT

No HIGH/MEDIUM. Row press is not routed through UISwitch user interaction (RowSwitch claims the responder; row press
reaches the switch only via the `value` prop; VoiceOver can only activate the row) → one haptic on every path. Test
discriminates removal, inversion, over-application and Android loss; expected calls captured per OS from real
`haptics.play`. haptics.suite.ts doc-vs-map still holds (row label prefix match, 3 cells).

- LOW: spec.md:502 amended without a `#### Scenario` for the iOS exception (deferred to the final LOW batch).
- LOW: the two UIKit claims (programmatic setOn makes no haptic; touch flip always does) are reasoned, not measured →
  owner checklist (#236 line: flip directly and via the row).
- LOW style: nested parenthesis in spec.md:502 (deferred to the final LOW batch).
