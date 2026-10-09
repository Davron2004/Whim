# DONE: sonar-r1-admission-snapshot
Findings: S27-S28, typescript:S7747, MINOR.
Use a rule-compliant snapshot representation. A mutation by a waiter/listener while notification runs must neither omit members of the pre-notification snapshot nor visit additions; FIFO handoff, updated positions, and listener once-only behavior remain unchanged. Existing admission move/leave assertions are the regression evidence.
