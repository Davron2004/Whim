/**
 * Ambient surface for the small slice of Node's built-in modules this library and its Node
 * acceptance suite use. Declared locally so the project needs no `@types/node` dependency
 * (mirrors `src/host/storage-engine/env.d.ts`'s identical precedent/rationale) — the
 * device/runtime bundles never import this module and are unaffected.
 */
declare module 'node:fs/promises' {
  export function readFile(path: string, encoding: 'utf8'): Promise<string>;
  export function writeFile(path: string, data: string, encoding: 'utf8'): Promise<void>;
  export function mkdtemp(prefix: string): Promise<string>;
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
}
declare module 'node:os' {
  export function tmpdir(): string;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}

// `process.cwd()` (repo-root path resolution, `builder.ts`/`page.ts`) and `process.exit()`
// (the Node acceptance suite's non-zero-exit-on-failure idiom, `test/acceptance.ts`).
interface WhimProcess {
  cwd(): string;
  exit(code?: number): never;
}
declare const process: WhimProcess;

// Node's global WebCrypto (available since Node 19+) — used for run-id generation
// (`session.ts`), never for anything security-sensitive.
interface WhimCrypto {
  randomUUID(): string;
}
declare const crypto: WhimCrypto;
