/**
 * `node:module`'s `createRequire`, which lib/source-map.ts uses to find metro-symbolicate from the
 * repo root. Kept out of env.d.ts because that file is a module, where `declare module` can only
 * augment a module some other declaration already provides, and nothing else declares this one.
 */

declare module 'node:module' {
  export function createRequire(path: string): { resolve(request: string): string };
}
