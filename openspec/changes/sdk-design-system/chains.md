# Chains: sdk-design-system

Rules honored: 3–7 tasks per chain, grouped by files/layer; each chain completable from design.md excerpts + declared contracts; handoffs are interfaces ≤60 lines.

## chain-A: theme-core
- tasks: 1.1, 1.2, 1.3
- rationale: everything else consumes the theme shapes and resolvers; smallest possible foundation.
- reads: design.md "The theme model" + D1, D2, D5; research.md "SDK surface".
- writes-contract: handoff/theme.md (WhimTheme/ThemePref/ThemeShape verbatim, preset/accent ids, resolveTheme/sanitizeTheme/DEFAULT_THEME signatures, resolver + caching behavior, FONT constant).

## chain-B: sdk-controls
- tasks: 2.1, 2.2, 2.3
- rationale: interactive components share event/appearance discipline; one file, one review lens.
- reads: design.md D5, D6; handoff/theme.md.
- writes-contract: none (index.tsx re-exports are the interface; props are in design D6).

## chain-C: sdk-surfaces
- tasks: 3.1, 3.2, 3.3
- rationale: presentational components; independent of controls except index.tsx merge — runs after chain-B to avoid same-file races.
- reads: design.md D5, D6; handoff/theme.md.
- writes-contract: none.

## chain-D: runtime-theme-delivery
- tasks: 4.1, 4.2, 4.3 (agent); 4.4 (MAIN THREAD — NOT IMPLEMENTER-DISPATCHABLE: build/assemble.mjs + build/build.mjs are hook-protected).
- rationale: the host→iframe seam, kept as small as possible; loader edit is trusted-region and additive-only.
- reads: design.md D1, D8; research.md "Host→iframe data flow"; handoff/theme.md (serialization validation only).
- writes-contract: handoff/delivery.md (reinject opts shape incl. theme, __WHIM_THEME__ global semantics, deliverBySourceJs/deliverBySource signatures).
- note: runs parallel to chain-A (no shared files; the global name and validation regex are fixed in design.md).

## chain-E: launcher-theme-state
- tasks: 5.1, 5.2, 5.3
- rationale: pure logic + context, fully coverable by launcher:test before any UI exists.
- reads: design.md D4, D7; handoff/theme.md; research.md "Launcher shell".
- writes-contract: handoff/launcher-theme.md (context value shape, useTheme, shellPalette output keys, pref key + load/save signatures).

## chain-F: launcher-ui
- tasks: 6.1, 6.2, 6.3, 6.4, 6.5
- rationale: all visible shell changes in one pass so the restyle is coherent.
- reads: design.md D3, D7, D8; handoff/launcher-theme.md; handoff/delivery.md.
- writes-contract: none.

## chain-G: gallery-and-docs
- tasks: 7.1, 7.2 (agent); 7.3 (MAIN THREAD).
- rationale: needs the full kit (B, C) and build registration (4.4) in place; doubles as end-to-end verification.
- reads: design.md D6, D9; docs/sdk-reference.md structure free; fixtures/tip-splitter.app.tsx as the fixture template.
- writes-contract: none.

Execution order: A ∥ D-agent → B ∥ E → C ∥ F → 4.4(main) → G → close-out. Commits at every chain boundary; scripts/gate.sh at B, F, G; gate-full once before merge.
