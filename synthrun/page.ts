/**
 * Page assembly (design D6; spec §The candidate boots in the unmodified production runtime
 * page). Assembles pages EXCLUSIVELY from `build/assemble.mjs`'s `buildSrcdoc`/`buildOuterHtml`
 * and `src/runtime/generated/runtime-artifacts.json`'s `parts` — never forks, patches, or
 * loosens the page, the CSP, or the loader. Both are consumed strictly read-only.
 */
// `assemble.d.ts`'s ambient module declaration is otherwise never reached — the root RN tsconfig
// discovers it via its own repo-wide `include` glob, but `server/tsconfig.json` (`allowJs` off, a
// narrower `include`) only reaches files THIS file's own import graph pulls in (chain 6:
// `session.ts`/`page.ts` are now transitively imported once a composition root imports
// `synthrun/session.ts`). The triple-slash reference makes that ambient module visible regardless
// of which project's `include` glob is doing the reaching.
/// <reference path="./assemble.d.ts" />
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
// build/assemble.mjs is the production page assembler (read-only production artifact, no .ts
// counterpart) — its JSDoc types the parameters `buildSrcdoc`/`buildOuterHtml` take.
import { buildOuterHtml, buildSrcdoc } from '../build/assemble.mjs';

// `process.cwd()` (the repo root) — see `builder.ts`'s identical comment on why NOT
// `import.meta.url` (this module gets bundled together with Node acceptance-suite entries).
const ROOT = process.cwd();

export interface RuntimeParts {
  neutralize: string;
  reactInject: string;
  resolver: string;
  sdkInject: string;
  probes: string;
  syscall: string;
  loader: string;
}

let cachedParts: RuntimeParts | undefined;

/**
 * Read `runtime-artifacts.json`'s `parts` (produced by `npm run build`, read-only). Cached for
 * the life of the process — this harness never regenerates or mutates the artifact.
 */
export async function loadRuntimeParts(): Promise<RuntimeParts> {
  if (!cachedParts) {
    const raw = await readFile(join(ROOT, 'src/runtime/generated/runtime-artifacts.json'), 'utf8');
    const artifacts = JSON.parse(raw) as { parts: RuntimeParts };
    cachedParts = artifacts.parts;
  }
  return cachedParts;
}

/**
 * Assemble the WebView page for ONE candidate bundle. `syscallSink: 'exposed'` routes bundle
 * syscalls to a Playwright-exposed Node host function (`window.whimHostDispatch`) — the seam
 * capability wiring (chain 3, design D3) attaches to, mirroring the bridge-invariants recipe.
 * Diagnostics render on-screen is left off (`showDiagnostics: false`): every failure-grade
 * signal this harness reads comes from the nonce-authenticated frame listener / CDP, never the
 * DOM (spec §Observation is trusted-vantage only).
 */
export async function assembleCandidatePage(candidateJs: string, candidateName = 'candidate'): Promise<string> {
  const parts = await loadRuntimeParts();
  const srcdoc = buildSrcdoc({ parts, channel: 'b' });
  return buildOuterHtml({
    srcdoc,
    bundles: { [candidateName]: candidateJs },
    initial: candidateName,
    channel: 'b',
    showDiagnostics: false,
    autostart: true,
    syscallSink: 'exposed',
  });
}
