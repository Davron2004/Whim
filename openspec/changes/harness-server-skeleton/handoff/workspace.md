# Handoff: workspace.md (chain-A → B, C, D)

Interface for the npm-workspace layout chain-A establishes. Later chains read this; they never
re-derive paths or script names from context.

## Packages
- `@whim/contract` — root `contract/`. `package.json`: `main`/`exports` → `./src/index.ts`;
  runtime deps: `zod` only (NO react/react-native/framework dep — budget scenario).
- `@whim/server` — root `server/`. Runtime deps exactly: `hono`, `@hono/node-server`,
  `@whim/contract`. Dev: `esbuild` (inherited from root).

## Directory + tsconfig roots
- `contract/src/index.ts` — the single contract entry (all schemas + `z.infer` exports).
- `contract/tsconfig.json`, `server/tsconfig.json` — standalone Node-flavored (per design D7,
  NOT the RN root): `module`/`moduleResolution` = `bundler`, `strict` on, `noEmit`; `server` adds
  node types. Both dirs are excluded from the RN root tsconfig; `server:test` typechecks them
  (`tsc --noEmit` over each), esbuild bundles.
- `server/src/**` — service source. `server/test/**` — suite. `server/.data/` — gitignored.

## Root npm scripts (added in chain-A)
- `server:dev` → bundle+run `server/dev.mjs` (binds `0.0.0.0`, `WHIM_SERVER_PORT`, default `8787`).
- `server:test` → run `server/test/run.mjs`; includes `tsc --noEmit` over BOTH packages.
- `guard:metro` → prove the Android RN bundle still resolves with the new install layout.

## Env / data
- `WHIM_DATA_DIR` — SQLite root, default `server/.data/` (gitignored). `WHIM_SERVER_PORT` — default `8787`.

## Test idiom (replicate verbatim)
`server/test/run.mjs` mirrors `src/host/bridge/test/run.mjs`: esbuild `bundle:true`,
`platform:'node'`, `format:'esm'`, `target:'node20'`; dynamic `import(pathToFileURL(outfile))`;
`rmSync` cleanup. No test framework — assertions throw.

## Invariants
- Both packages are TS-source-only; nothing emits to `dist/`.
- `@whim/contract` has zero React-adjacent runtime deps.
- Re-run `npm install` after chain-A so workspace symlinks exist before B/C/D.
