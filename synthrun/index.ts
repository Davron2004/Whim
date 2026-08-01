/**
 * synthrun — public surface (design D5: a plain top-level directory, `checks/`-style, no
 * workspace entry, dependency-light TS source importable by `server/` later).
 *
 * Chain 1 exports the entry-point TYPES (`contract.ts`), the candidate builder (`builder.ts`),
 * production page assembly (`page.ts`), and the Chromium session lifecycle (`session.ts`).
 * Chain 2 adds trusted-vantage observation + the watchdog (`observe.ts`, `handoff/
 * observe-api.md`). Chain 3 adds capability wiring (`capability.ts`). Chain 4 adds the
 * interaction sweep (`sweep.ts`). Chain 5 assembles the full `RunCandidate` entry point the
 * spec's "one candidate in, one deterministic run report out" requirement describes
 * (`report.ts`'s `createRunCandidate`), composing all of the above on top of
 * `SynthRunSession.openRun`. See `handoff/harness-core.md`.
 */
export * from './contract';
export * from './builder';
export * from './page';
export * from './session';
export * from './observe';
export * from './capability';
export * from './sweep';
export * from './report';
