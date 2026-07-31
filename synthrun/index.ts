/**
 * synthrun — public surface (design D5: a plain top-level directory, `checks/`-style, no
 * workspace entry, dependency-light TS source importable by `server/` later).
 *
 * Chain 1 (this file) exports the entry-point TYPES (`contract.ts`), the candidate builder
 * (`builder.ts`), production page assembly (`page.ts`), and the Chromium session lifecycle
 * (`session.ts`). The full `RunCandidate` entry point the spec's "one candidate in, one
 * deterministic run report out" requirement describes is assembled by chain 5 (task 5.2),
 * composing observation (chain 2), capability wiring (chain 3), and the interaction sweep
 * (chain 4) on top of `SynthRunSession.openRun`. See `handoff/harness-core.md`.
 */
export * from './contract';
export * from './builder';
export * from './page';
export * from './session';
