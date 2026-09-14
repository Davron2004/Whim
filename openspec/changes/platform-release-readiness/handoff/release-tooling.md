# release-tooling (chain-1 → all later chains)

## `scripts/release/lib/native-config.ts`

```ts
export const NATIVE_RELEASE_CONFIG_PATH = 'release/whim-release.xcconfig';
export const NATIVE_RELEASE_CONFIG_KEYS = [
  'WHIM_APP_ID', 'WHIM_APPLE_TEAM_ID', 'WHIM_MARKETING_VERSION', 'WHIM_BUILD_NUMBER', 'WHIM_DOMAIN',
] as const;
export type NativeReleaseConfigKey = (typeof NATIVE_RELEASE_CONFIG_KEYS)[number];

export interface NativeReleaseConfig {
  readonly WHIM_APP_ID: string;
  readonly WHIM_APPLE_TEAM_ID: string;
  readonly WHIM_MARKETING_VERSION: string;
  readonly WHIM_BUILD_NUMBER: string; // literal text — parse with Number()/parseInt if you need a number
  readonly WHIM_DOMAIN: string;
}

export class NativeConfigError extends Error {
  readonly line: number; // 1-based; a missing-key error uses the line past EOF (no single offending line)
}

export function parseNativeReleaseConfig(text: string): NativeReleaseConfig; // throws NativeConfigError
export function loadNativeReleaseConfig(repoRoot: string): NativeReleaseConfig; // reads NATIVE_RELEASE_CONFIG_PATH under repoRoot

export interface NativeLiteralFinding {
  readonly file: string; // repo-relative, as `git ls-files` reports it
  readonly line: number; // 1-based
  readonly key: 'WHIM_APP_ID' | 'WHIM_APPLE_TEAM_ID' | 'WHIM_DOMAIN' | 'WHIM_MARKETING_VERSION';
  readonly literal: string;
}
// Scans every git-tracked, non-binary file under ios/ and android/ for WHIM_APP_ID/
// WHIM_APPLE_TEAM_ID/WHIM_DOMAIN literals, plus WHIM_MARKETING_VERSION literals in exactly
// project.pbxproj, Info.plist (by basename) and android/app/build.gradle (by exact path).
// Shells ONLY to `git ls-files` (chains.md's suite-portability rule).
export function scanNativeLiterals(repoRoot: string, config: NativeReleaseConfig): NativeLiteralFinding[];
```

## `scripts/release/lib/build-number.ts`

```ts
export const BUILD_NUMBER_EPOCH_UTC: number; // 2026-01-01T00:00:00.000Z, epoch ms
export function buildNumberAt(date: Date): number; // floor((date-epoch)/60s); throws Error if date < epoch
export function assertBuildNumberAbove(build: number, storeLatest: number): void; // throws Error naming both numbers
```

## `scripts/release/env.d.ts` — ambient Node surface (no `@types/node`)

Declares `node:fs` (`readFileSync`, two overloads), `node:path` (`join`, `basename`),
`node:child_process` (`execFileSync(file, args, { cwd?, encoding: 'utf8' })`), and widens the
shared `WhimProcess` (already declared by `synthrun/env.d.ts`/`evals/env.d.ts`) with
`stdout`/`stderr: { write(chunk: string): boolean }`. Buffers are typed via
`import type { Buffer as NodeBuffer } from 'buffer'` (the real polyfill package, not `@types/node`)
— import that alias directly in any new `lib/*.ts` file that needs it. To add a Node built-in or
export this file doesn't cover, add your own `declare module '...'` fragment in your own file —
ambient module/interface declarations merge additively across every `.d.ts` in the program; never
edit this file from another chain.

## `scripts/release/cli.ts` + `run.mjs`

`COMMANDS: Record<string, { summary: string; run(args: string[]): number | Promise<number> }>`.
Add one entry per command — never a second table. `run(args)` returns the process exit code (0
success). `runCli(argv: string[]): Promise<number>` dispatches `argv[0]` to `COMMANDS`; an unknown
or missing command prints the table and returns `2`.

Invocation: `node scripts/release/run.mjs <command> [args]`. `run.mjs` esbuild-bundles `cli.ts`
(external `['typescript', 'playwright']`, `tsconfigRaw: '{}'`) to a pid-named temp file, imports
it, sets `process.exitCode = await cli.runCli(process.argv.slice(2))`, deletes the temp file in
`finally`. Chain-1 ships only `build-number [--at <iso>]`; later chains add `native-config --json`,
`preflight`, `verify-aab`, `privacy-audit`, `association-files`, `generate-assets`, `tag`.

## Release suites: `run()` convention

Each `checks/test/release/<name>.suite.ts` exports `export async function run(): Promise<void>`,
calling `checks/test/harness.ts`'s `test(name, fn)` / `assert(cond, msg)` for its own scenarios
(no `greenBy` tag needed — this program has no `.phase` file, so untagged `test()` calls are due
immediately). A suite never calls `harness.ts`'s `report()` itself. `checks/test/release/index.ts`
imports `{ run as run<Name> }` from all eight suites and awaits them in chains.md's file-list
order inside `runReleaseSuites()`. `checks/test/acceptance.ts` imports `runReleaseSuites` from
`./release` and calls it once, last, in `main()`, after `runHostileCorpus()`.

**No later chain may edit `checks/test/release/index.ts` or `checks/test/acceptance.ts`** — fill
only your own `<name>.suite.ts`'s `run()` body.

## Suite file → owning chain map

| Suite file | Owning chain |
|---|---|
| `native-config.suite.ts` | chain-1 (filled) |
| `hermes-entry.suite.ts` | chain-2 |
| `ios-project.suite.ts` | chain-3 |
| `android-project.suite.ts` | chain-4 |
| `assets.suite.ts` | chain-6 |
| `store-listing.suite.ts` | chain-8 |
| `release-cli.suite.ts` | chain-9 |
| `domain-lockstep.suite.ts` | chain-11 |

## Native release file

`release/whim-release.xcconfig` holds design D1's five keys/defaults verbatim (`WHIM_DOMAIN =
example.com`, a placeholder — D14 blocks uploads on it, not the gate). Grammar: `KEY = VALUE`,
`//` comments, blank lines; no `#include`, no `$(...)`; all five keys required exactly once.
