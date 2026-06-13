# Context chains: <!-- change-id -->

<!--
  Tasks from tasks.md grouped into context chains for the dispatcher.
  Rules: 3–7 tasks per chain (≤~800 lines expected diff), grouped by shared
  files/layer, sequential by default. Each chain must be completable from ONLY
  its named spec excerpts + contracts from earlier chains — if a task needs
  "whatever an earlier chain happened to learn," promote that into a contract.
  Declare a writes-contract for every chain whose outputs a later chain consumes.
  A contract (handoff/*.md) is an interface, hard-capped at 60 lines.
-->

## chain-1: <layer>-<name>
- tasks: <1.1–1.4>
- rationale: <why these tasks share working context>
- reads: <specs/<capability>/spec.md §X–Y>; handoff: <none | handoff/<name>.md>
- writes-contract: <none | handoff/<name>.md>

## chain-2: <layer>-<name>
- tasks: <2.1–2.3>
- rationale: <why these tasks share working context>
- reads: <specs/<capability>/spec.md §Z>; handoff: <handoff/<name>.md>
- writes-contract: <none>
