/**
 * Ambient surface for the small slice of Node's built-in modules `evals/` and its Node
 * acceptance suite use. Declared locally so the project needs no `@types/node` dependency
 * (mirrors `synthrun/env.d.ts` / `src/host/storage-engine/env.d.ts`'s identical
 * precedent/rationale) — the device/runtime bundles never import anything under `evals/` and
 * are unaffected.
 */
declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string, encoding: 'utf8'): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  export function readdirSync(path: string): string[];
  export function mkdtempSync(prefix: string): string;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
}
declare module 'node:os' {
  export function tmpdir(): string;
}
declare module 'node:crypto' {
  export interface Hash {
    update(data: string, encoding: 'utf8'): Hash;
    digest(encoding: 'hex'): string;
  }
  export function createHash(algorithm: 'sha256'): Hash;
}
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
  export function pathToFileURL(path: string): URL;
}
// The live judge (`evals/judge/live.ts`) shells out to the `esbuild` CLI binary rather than
// importing esbuild's JS API, so `evals/test/run.mjs`'s bundling of `*.test.ts` never inlines
// esbuild into itself (the "esbuild-in-esbuild" dynamic-require hazard).
declare module 'node:child_process' {
  export function execFileSync(file: string, args?: string[]): unknown;
}

// `process.cwd()`/`process.argv`/`process.env` (location resolution, corpus-drift fixture
// reads) and `process.exit()` (the Node acceptance suite's non-zero-exit-on-failure idiom).
interface WhimProcess {
  cwd(): string;
  argv: string[];
  env: Record<string, string | undefined>;
  exit(code?: number): never;
  pid: number;
}
declare const process: WhimProcess;
