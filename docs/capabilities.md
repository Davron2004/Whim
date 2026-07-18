# Capability index
<!-- One line per capability. The "map, not manual": this is what a researcher reads FIRST so
     proposal cost scales with change size, not project size. Update when archiving a change
     (one extra line in the /opsx:archive ritual) and when a spec's scope materially shifts. -->

| Capability | What it covers | Spec |
|---|---|---|
| sandbox-isolation | Contained WebView execution: forbidden escape-hatch globals are dead; iframe + locked CSP hold the boundary | openspec/specs/sandbox-isolation/spec.md |
| sandbox-rendering | An SDK-only bundle renders its UI inside the WebView via the React-to-DOM path, knowing nothing of its host | openspec/specs/sandbox-rendering/spec.md |
| capability-bridge | Native-backed effects are reachable only as governed syscalls over an append-only capability registry | openspec/specs/capability-bridge/spec.md |
| mini-app-effects | Timed effects (`delay`/`interval`) are web-resident SDK exports that never touch the bridge; the runtime tears them down on unmount and realm reset | openspec/specs/mini-app-effects/spec.md |
| mini-app-cues | Physical cues (haptics, sounds) are manifest-gated `cues` syscalls over closed token sets, fire-and-forget and at-most-once, resolved by a host-injected backend | openspec/specs/mini-app-cues/spec.md |
| mini-app-storage | Each mini-app's user data lives in its own physically-isolated SQLite store; no per-call app addressing exists | openspec/specs/mini-app-storage/spec.md |
| storage-schema-evolution | Schema-declared storage with burned IDs as the physical keys; a rename is a display change needing no DDL | openspec/specs/storage-schema-evolution/spec.md |
| mini-app-versioning | Every generation is an immutable snapshot tagged with the structured prompt that produced it | openspec/specs/mini-app-versioning/spec.md |
| mini-app-forking | A mini-app can be forked from any snapshot into an independent lineage that diverges without touching the original | openspec/specs/mini-app-forking/spec.md |
| app-launcher | The product shell: installed-apps grid, correct card→app routing, status-bar-safe insets, no dev diagnostics in shipping builds, persisted theme preference restyling shell + delivered mini-apps | openspec/specs/app-launcher/spec.md |
| mini-app-back-navigation | System back inside a mini-app is handled with a guaranteed exit-to-home, never a crash or trap | openspec/specs/mini-app-back-navigation/spec.md |
| sdk-navigation | Mini-app-owned screen stacks through the stable `nav` object, with depth hints for system-back coordination and a statically analyzable literal-target graph | openspec/specs/sdk-navigation/spec.md |
| sdk-design-system | Themeable semantic tokens + full component kit (controls, surfaces) resolved through a sanitized, inert host-supplied theme, rendered under the unchanged containment contract | openspec/specs/sdk-design-system/spec.md |
| generation-contract | The shared device↔server wire contract: zod schemas for generation/rewrite requests, the SSE event stream, diagnostics envelope, wire app record, and usage — zod-only, TS-source-only, Metro-safe | openspec/specs/generation-contract/spec.md |
| generation-server | The harness server skeleton (Hono): SSE generation over a stub pipeline, canned rewrite, device-UUID identity, durable token metering + usage readback, and the unmounted OpenRouter client wrapper | openspec/specs/generation-server/spec.md |
| sdk-charts | The `Chart` SDK export — bar/line + calendar heatmap for the Tier-0 corpus apps, token-themed, rendered under the unchanged containment contract | openspec/changes/sdk-charts/specs/sdk-charts/spec.md |
| static-checks | A pure, execution-free AST library: candidate mini-app source string in, structured CheckReport out (parse / import-allowlist / forbidden-global / capability / screen-graph / SDK-lint / schema passes); never authoritative for containment or run-behavior | openspec/specs/static-checks/spec.md |
| harness-diagnostics | Every diagnostic (static or runtime) is structured data with a machine-readable kind, severity, source position, and a mandatory actionable fix hint | openspec/specs/harness-diagnostics/spec.md |
| staging-integration-lane | Every harness run integrates on its own per-run `integration/<run-id>` branch, never on `main`; `main` gets exactly one human-ratified merge per run | openspec/specs/staging-integration-lane/spec.md |
| sonar-recurrence-tracking | Append-only ledger of external SonarCloud findings across fix rounds; critic reports recurrence-based promotion candidates, promotion into lint config stays human-ratified | openspec/specs/sonar-recurrence-tracking/spec.md |
