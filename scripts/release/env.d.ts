/**
 * Ambient surface for the small slice of Node's built-ins and process I/O the release tooling
 * uses. Declared locally so the project needs no `@types/node` dependency (mirrors
 * `synthrun/env.d.ts` / `evals/env.d.ts` / `src/host/storage-engine/env.d.ts`'s identical
 * precedent/rationale — the app's tsconfig pins `types: ["jest"]`) — the device/runtime
 * bundles never import anything under `scripts/` and are unaffected. `declare module` blocks
 * and the `WhimProcess` interface merge additively across every env.d.ts in the program, so a
 * later `scripts/release/lib/*.ts` file needing a Node built-in or a `process` member this file
 * doesn't yet cover adds its own fragment here rather than re-declaring the whole surface.
 */

import type { Buffer as NodeBuffer } from 'buffer';

declare module 'node:fs' {
  export function readFileSync(path: string): NodeBuffer;
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function basename(path: string): string;
}
declare module 'node:child_process' {
  export function execFileSync(file: string, args: string[], options: { cwd?: string; encoding: 'utf8' }): string;
  // Used where the tool's output arrives on stderr (java -version); execFileSync returns stdout only.
  export function spawnSync(
    file: string,
    args: string[],
    options: { cwd?: string; encoding: 'utf8' },
  ): { readonly status: number | null; readonly stdout: string; readonly stderr: string; readonly error?: Error };
}

declare global {
  // Widens the shared `WhimProcess` (synthrun/env.d.ts, evals/env.d.ts) with the stdout/stderr
  // writers the release CLI prints through (design D12 — every command "prints" its result).
  interface WhimProcess {
    readonly stdout: { write(chunk: string): boolean };
    readonly stderr: { write(chunk: string): boolean };
  }
}

export {};
