/**
 * Ambient types for `build/assemble.mjs` (the production page assembler — read-only artifact, no
 * `.ts` counterpart; its own JSDoc types `buildSrcdoc`/`buildOuterHtml`). Split out of `env.d.ts`
 * on purpose: `env.d.ts`'s `process`/`crypto` polyfills exist ONLY so the root RN tsconfig (no
 * `@types/node`) can check this library — pulling that file into a REAL-`@types/node` project
 * (chain 6: `server/tsconfig.json`, once `session.ts`/`page.ts` are transitively imported) would
 * shadow the real `process`/`crypto` globals project-wide. This file declares nothing but the one
 * missing module, so it is safe to pull in from any project. Referenced from `page.ts` via a
 * triple-slash directive — `server/tsconfig.json`'s `include` glob never reaches `synthrun/`
 * directly, only the files its own import graph pulls in, and a plain ambient `.d.ts` that
 * nothing imports would otherwise never join that graph.
 *
 * The module specifier below is a WILDCARD (a leading `*` segment, then `build/assemble.mjs`),
 * not the literal relative path `page.ts` imports (`../build/assemble.mjs`) — measured, not
 * stylistic: TypeScript's module resolver does not consult ambient "declare module" blocks for
 * relative specifiers at all (only non-relative/wildcard ones reach the ambient-module table once
 * real-file resolution fails), so a literal relative-path declaration here silently never matches.
 */
declare module '*/build/assemble.mjs' {
  export function buildSrcdoc(o: {
    parts: { neutralize: string; reactInject: string; resolver: string; sdkInject: string; probes: string; syscall: string; loader: string };
    channel: 'a' | 'b' | 'c';
    bakedBundle?: string;
  }): string;
  export function buildOuterHtml(o: {
    srcdoc: string;
    bundles: Record<string, string>;
    initial: string;
    channel: 'a' | 'b' | 'c';
    showDiagnostics?: boolean;
    autostart?: boolean;
    syscallSink?: 'rn' | 'exposed';
  }): string;
}
