# Capability index
<!-- One line per capability. The "map, not manual": this is what a researcher reads FIRST so
     proposal cost scales with change size, not project size. Update when archiving a change
     (one extra line in the /opsx:archive ritual) and when a spec's scope materially shifts. -->

| Capability | What it covers | Spec |
|---|---|---|
| sandbox-isolation | Contained WebView execution: forbidden escape-hatch globals are dead; iframe + locked CSP hold the boundary | openspec/specs/sandbox-isolation/spec.md |
| sandbox-rendering | An SDK-only bundle renders its UI inside the WebView via the React-to-DOM path, knowing nothing of its host | openspec/specs/sandbox-rendering/spec.md |
| capability-bridge | Native-backed effects are reachable only as governed syscalls over an append-only capability registry | openspec/specs/capability-bridge/spec.md |
| mini-app-storage | Each mini-app's user data lives in its own physically-isolated SQLite store; no per-call app addressing exists | openspec/specs/mini-app-storage/spec.md |
| storage-schema-evolution | Schema-declared storage with burned IDs as the physical keys; a rename is a display change needing no DDL | openspec/specs/storage-schema-evolution/spec.md |
| mini-app-versioning | Every generation is an immutable snapshot tagged with the structured prompt that produced it | openspec/specs/mini-app-versioning/spec.md |
| mini-app-forking | A mini-app can be forked from any snapshot into an independent lineage that diverges without touching the original | openspec/specs/mini-app-forking/spec.md |
