# Context chains: sdk-charts

## chain-1: sdk-chart-geometry

- tasks: 1.1–1.5
- rationale: pure data-to-geometry math plus its Node suite — one vocabulary (scales, buckets, grids), zero React/DOM context, fully verifiable standalone
- reads: specs/sdk-charts/spec.md §Degenerate data renders safely + §heatmap scenario; design.md decisions 2, 4, 5, 7; handoff: none
- writes-contract: handoff/chart-geometry.md (exported function signatures, input/output types verbatim, clamping/dropping semantics, bucketing guarantees)

## chain-2: sdk-chart-component

- tasks: 2.1–2.5
- rationale: everything that renders — the discriminated props union, the SVG frame, and the three kind renderers all live in one file and share the theme/token idiom
- reads: specs/sdk-charts/spec.md §single declarative Chart + §theme-derived and self-contained + §Degenerate data; design.md decisions 1–6; handoff: handoff/chart-geometry.md
- writes-contract: handoff/chart-props.md (the `ChartProps` union verbatim, prop defaults, empty-data placeholder behavior, what `index.tsx` re-exports)

## chain-3: gallery-docs-closeout

- tasks: 3.1–3.4
- rationale: consumers of the finished component — fixture demo, prompt-surface doc, ledger close-out, and the merge gate; needs only the props contract, not implementation context
- reads: specs/sdk-charts/spec.md §theme-derived + §gallery requirement; design.md decision 8; handoff: handoff/chart-props.md
- writes-contract: none
