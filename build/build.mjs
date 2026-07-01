// ─────────────────────────────────────────────────────────────────────────────
// Whim build — the LOCAL stand-in for the future server build (design D8).
// ─────────────────────────────────────────────────────────────────────────────
// Produces, with esbuild:
//   1. the react/react-dom INJECT IIFE (one shared instance on window — D3/4.1);
//   2. the vc-sdk INJECT IIFE (react external → window.React; H1b);
//   3. each app bundle as a single IIFE (classic JSX → React.createElement, vc-sdk/react/
//      react-dom external) + an EXTERNAL source map with sourcesContent (D4/3.6);
// then assembles:
//   • src/runtime/generated/runtime-html.ts  — the RN app's RUNTIME_HTML (channel b, tip
//     splitter, diagnostics off) the WebView loads;
//   • src/runtime/generated/runtime-artifacts.json — { parts, bundles } for the invariant
//     suite to generate scenario pages against THIS runtime (task 7.1);
//   • build/generated/<app>.app.js (+ .map) — the emitted bundles (reference + map check).
// Warm transpile+bundle is a few ms (negligible vs the future model latency).
import * as esbuild from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { buildSrcdoc, buildOuterHtml } from './assemble.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const r = (...p) => join(ROOT, ...p);
const read = (p) => readFile(r(p), 'utf8');

// ── esbuild bundlers ─────────────────────────────────────────────────────────
async function bundleInjectReact() {
  const out = await esbuild.build({
    entryPoints: [r('build/react-inject.js')],
    bundle: true, format: 'iife', platform: 'browser', target: 'es2019',
    minify: true, define: { 'process.env.NODE_ENV': '"production"' },
    write: false, logLevel: 'warning',
  });
  return out.outputFiles[0].text;
}

async function bundleInjectSdk() {
  const out = await esbuild.build({
    entryPoints: [r('build/vc-sdk-inject.ts')],
    bundle: true, format: 'iife', platform: 'browser', target: 'es2019',
    external: ['react', 'react-dom', 'react-dom/client'], // resolved at runtime via H1b → window.React
    minify: false, write: false, logLevel: 'warning',
  });
  return out.outputFiles[0].text;
}

// One app bundle → { js, map }. globalName installs the module namespace (with `.default`,
// the AppSpec) on the global the loader reads. The map is EXTERNAL with sourcesContent so a
// thrown error / static finding maps back to the agent's ORIGINAL .tsx line (D4 / gates §8.1).
async function bundleApp(entryRelPath) {
  const out = await esbuild.build({
    entryPoints: [r(entryRelPath)],
    bundle: true, format: 'iife', globalName: '__WHIM_APP_MODULE__',
    platform: 'browser', target: 'es2019',
    // CLASSIC JSX → React.createElement (the H1b contract). Isolate from the project
    // tsconfig (jsx:"react-jsx"), which esbuild auto-discovers and would otherwise use to
    // emit the AUTOMATIC runtime (`require("react/jsx-runtime")` — an off-allowlist specifier
    // the H1b resolver rejects at runtime). tsconfigRaw:'{}' makes these esbuild flags win.
    tsconfigRaw: '{}',
    jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment',
    inject: [r('build/react-inject-shim.ts')],
    external: ['vc-sdk', 'react', 'react-dom', 'react-dom/client'],
    sourcemap: 'external', sourcesContent: true,
    outdir: r('build/generated'), // needed for the external-map path even with write:false
    minify: false, write: false, logLevel: 'warning',
  });
  let js = '', map = '';
  for (const f of out.outputFiles) (f.path.endsWith('.map') ? (map = f.text) : (js = f.text));
  return { js, map };
}

// ── host-side app-record extraction (capability-bridge task 2.4) ────────────────
// Bundle a fixture for Node with `vc-sdk` resolved to the REAL SDK and react/react-dom stubbed
// (components are never rendered during extraction — we only read `.default`), import it, and
// read the declared {name, capabilities, schema}. This is the single source of truth: a fixture
// cannot declare one manifest in `defineApp` and have the host gate a different one.
const REACT_STUB =
  'export const createElement=function(){return null;};' +
  "export const Fragment='Fragment';" +
  'export const useState=function(v){return [typeof v===\"function\"?v():v,function(){}];};' +
  'export const useEffect=function(){};' +
  'export default {createElement:createElement,Fragment:Fragment,useState:useState,useEffect:useEffect};';

async function extractAppRecord(appId, entryRelPath) {
  const fallback = { appId, name: appId, manifest: { capabilities: [] }, schemaArtifact: undefined };
  try {
    const out = await esbuild.build({
      entryPoints: [r(entryRelPath)],
      bundle: true, format: 'esm', platform: 'node', target: 'node20',
      tsconfigRaw: '{}', jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment',
      write: false, logLevel: 'silent',
      plugins: [{
        name: 'whim-extract-stubs',
        setup(build) {
          build.onResolve({ filter: /^vc-sdk$/ }, () => ({ path: r('src/sdk/index.tsx') }));
          build.onResolve({ filter: /^(react|react-dom|react-dom\/client)$/ }, () => ({ path: 'whim-react-stub', namespace: 'whim-stub' }));
          build.onLoad({ filter: /.*/, namespace: 'whim-stub' }, () => ({ contents: REACT_STUB, loader: 'js' }));
        },
      }],
    });
    const code = out.outputFiles[0].text;
    const mod = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
    const spec = mod.default || {};
    return {
      ok: true,
      record: {
        appId,
        name: typeof spec.name === 'string' ? spec.name : appId,
        manifest: { capabilities: Array.isArray(spec.capabilities) ? spec.capabilities : [] },
        schemaArtifact: spec.schema,
      },
    };
  } catch (e) {
    console.log(`  app-record extract: ${appId} → default [] (${e.message.split('\n')[0]})`);
    return { ok: false, record: fallback };
  }
}

// ── minimal source-map consumer (verify the D4 round-trip without a heavy dep) ──
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function decodeVlq(segment) {
  const out = []; let shift = 0, value = 0;
  for (const ch of segment) {
    const d = B64.indexOf(ch); if (d < 0) continue;
    const cont = d & 32, digit = d & 31;
    value += digit << shift;
    if (cont) { shift += 5; } else {
      const neg = value & 1; value >>= 1; out.push(neg ? -value : value); value = 0; shift = 0;
    }
  }
  return out;
}
// Map a generated 0-based line → the original {source, line} of its first segment.
function originForGeneratedLine(map, genLine) {
  const groups = map.mappings.split(';');
  let srcIdx = 0, srcLine = 0;
  for (let gl = 0; gl < groups.length; gl++) {
    const segs = groups[gl].split(',').filter(Boolean);
    for (const seg of segs) {
      const f = decodeVlq(seg);
      // f[0] is the generated-column delta — unused here (we only need source index + line), so
      // it is decoded but not accumulated. f[1]/f[2] are the source-index / source-line deltas.
      if (f.length >= 4) { srcIdx += f[1]; srcLine += f[2]; if (gl === genLine) return { source: map.sources[srcIdx], line: srcLine + 1 }; }
    }
  }
  return null;
}

async function verifySourceMap(appName, js, mapText, originalRelPath, needle) {
  const map = JSON.parse(mapText);
  const original = await read(originalRelPath);
  const okVersion = map.version === 3;
  const okSources = (map.sources || []).some((s) => s.includes(appName));
  const okContent = Array.isArray(map.sourcesContent) && map.sourcesContent.some((c) => c && c.includes(needle));
  // Find a generated line containing the needle and map it back to the original .tsx line.
  const genLines = js.split('\n');
  const genLine = genLines.findIndex((l) => l.includes(needle));
  let mappedLine = null, mappedSource = null;
  if (genLine >= 0) {
    const origin = originForGeneratedLine(map, genLine);
    if (origin) { mappedLine = origin.line; mappedSource = origin.source; }
  }
  const origNeedleLine = original.split('\n').findIndex((l) => l.includes(needle)) + 1;
  const roundTrips =
    mappedLine != null && mappedSource && mappedSource.includes(appName) &&
    Math.abs(mappedLine - origNeedleLine) <= 1; // ±1 tolerance for transform line shifts
  return { okVersion, okSources, okContent, genLine: genLine + 1, mappedLine, origNeedleLine, roundTrips };
}

// ── orchestrate ────────────────────────────────────────────────────────────────
async function main() {
  console.log('Whim build: transpiling runtime + bundles with esbuild…');

  const [neutralize, resolver, probes, syscall, loader] = await Promise.all([
    read('src/runtime/web/neutralize.js'),
    read('src/runtime/web/resolver.js'),
    read('src/runtime/web/probes.js'),
    read('src/runtime/web/syscall.js'),
    read('src/runtime/web/loader.js'),
  ]);
  const reactInject = await bundleInjectReact();
  const sdkInject = await bundleInjectSdk();
  const parts = { neutralize, reactInject, resolver, sdkInject, probes, syscall, loader };

  // App bundles. tip-splitter + water-counter are real apps; the adversarial ones feed the
  // invariant suite (sandbox-escape: evil/poison/victim; bridge: cap-intruder/sql-injector).
  const APPS = {
    'tip-splitter': 'fixtures/tip-splitter.app.tsx',
    'water-counter': 'fixtures/water-counter.app.tsx',
    'latency-probe': 'fixtures/latency-probe.app.tsx',
    'pour-over-timer': 'fixtures/pour-over-timer.app.tsx',
    evil: 'fixtures/adversarial/evil.app.tsx',
    poison: 'fixtures/adversarial/poison.app.tsx',
    victim: 'fixtures/adversarial/victim.app.tsx',
    'cap-intruder': 'fixtures/adversarial/cap-intruder.app.tsx',
    'sql-injector': 'fixtures/adversarial/sql-injector.app.tsx',
    // effects-and-cues invariants (runtime-owner, tasks 7.x): INV-TIMER's observable interval
    // ticker (sandbox-isolation suite) + INV-CUEGATE's hostile cue-gate intruder (bridge suite).
    'timer-ticker': 'fixtures/adversarial/timer-ticker.app.tsx',
    'cue-intruder': 'fixtures/adversarial/cue-intruder.app.tsx',
  };
  const bundles = {};
  const maps = {};
  for (const [name, entry] of Object.entries(APPS)) {
    const { js, map } = await bundleApp(entry);
    bundles[name] = js;
    maps[name] = map;
    console.log(`  bundled ${name} (${(js.length / 1024).toFixed(1)} KiB IIFE)`);
  }

  // ── Host-side app records (capability-bridge task 2.4) ──────────────────────────
  // Extract each fixture's declared {capabilities, schema} from the SAME source the bundle is
  // built from, so the host-held manifest the gate enforces cannot drift from the in-bundle
  // declaration. (The harness inherits this extraction job later.) Best-effort: the throwaway
  // sandbox-escape fixtures run module-scope attacks that throw under Node — they declare no
  // capabilities, so a failed extract defaults to [] correctly.
  // The sandbox-escape fixtures (evil/poison/victim) run module-scope attacks that touch
  // document/Object.prototype — never import them into the build process. They declare no
  // capabilities, so a static [] record is exactly right.
  const SKIP_EXTRACT = new Set(['evil', 'poison', 'victim']);
  const appRecords = {};
  const extractFailures = [];
  for (const [name, entry] of Object.entries(APPS)) {
    if (SKIP_EXTRACT.has(name)) {
      appRecords[name] = { appId: name, name, manifest: { capabilities: [] }, schemaArtifact: undefined };
      continue;
    }
    const { ok, record } = await extractAppRecord(name, entry);
    appRecords[name] = record;
    if (!ok) extractFailures.push(name);
  }
  for (const [name, rec] of Object.entries(appRecords)) {
    console.log(`  app-record ${name}: capabilities=[${rec.manifest.capabilities.join(',')}]${rec.schemaArtifact ? ' +schema' : ''}`);
  }
  // B3 — a non-adversarial fixture whose extraction THREW shipped a fallback capabilities=[] that
  // does not reflect its defineApp. At runtime the bridge gate would then silently deny every one
  // of its declared syscalls with NO build signal. Fail loudly instead of persisting the empty
  // record. (A fixture that legitimately declares [] extracts with ok:true, so it is not flagged —
  // this catches extraction FAILURE, not an intentionally empty capability set.)
  if (extractFailures.length) {
    throw new Error(
      `app-record extraction FAILED for non-adversarial fixture(s): ${extractFailures.join(', ')} — ` +
      'a fallback capabilities=[] would silently deny every bridge call at runtime; fix the fixture or the REACT_STUB',
    );
  }

  // D4 / task 3.6 — source-map round-trip for EVERY production TS fixture (B2). Each maps a
  // distinctive source needle back to its original .tsx line (±1). Verifying only tip-splitter
  // let a sourcesContent / round-trip regression on the other TypeScript entries ship silently;
  // removing `sourcesContent:true` from bundleApp now makes okContent false here → the build throws.
  const SMAP_CHECKS = [
    // Needles are function-BODY declarations (esbuild preserves those verbatim without minify;
    // top-level bindings get renamed/reordered by the bundler, so they make poor round-trip anchors).
    { name: 'tip-splitter', entry: 'fixtures/tip-splitter.app.tsx', needle: 'const money =' },
    { name: 'water-counter', entry: 'fixtures/water-counter.app.tsx', needle: 'const next =' },
    { name: 'pour-over-timer', entry: 'fixtures/pour-over-timer.app.tsx', needle: 'const stage =' },
  ];
  for (const chk of SMAP_CHECKS) {
    const smap = await verifySourceMap(chk.name, bundles[chk.name], maps[chk.name], chk.entry, chk.needle);
    console.log(
      `  source-map[${chk.name}]: v3=${smap.okVersion} sources✓=${smap.okSources} sourcesContent✓=${smap.okContent} ` +
      `round-trip=${smap.roundTrips} (generated L${smap.genLine} → original L${smap.mappedLine}, expected ~L${smap.origNeedleLine})`,
    );
    if (!(smap.okVersion && smap.okSources && smap.okContent && smap.roundTrips)) {
      throw new Error(`source-map round-trip verification FAILED for ${chk.name} (D4) — see values above`);
    }
  }

  // Emit the tip-splitter bundle + map (reference + the §8.1 repair-loop seam).
  await mkdir(r('build/generated'), { recursive: true });
  await writeFile(r('build/generated/tip-splitter.app.js'), bundles['tip-splitter']);
  await writeFile(r('build/generated/tip-splitter.app.js.map'), maps['tip-splitter']);

  // Assemble the RN app's RUNTIME_HTML — channel b, tip splitter, diagnostics OFF (showDiagnostics
  // is false below: the product shell renders a full-screen iframe with no on-screen probe JSON).
  const srcdocB = buildSrcdoc({ parts, channel: 'b' });
  const RUNTIME_HTML = buildOuterHtml({
    srcdoc: srcdocB,
    // tip-splitter is auto-delivered; `evil` is available for the on-device F4 negative control;
    // water-counter / sql-injector / cap-intruder are the capability-bridge on-device targets
    // (deliver-by-name via window.__whimControl + the host bridge wiring in WebViewHost).
    bundles: {
      'tip-splitter': bundles['tip-splitter'],
      'water-counter': bundles['water-counter'],
      'latency-probe': bundles['latency-probe'],
      'pour-over-timer': bundles['pour-over-timer'],
      'sql-injector': bundles['sql-injector'],
      'cap-intruder': bundles['cap-intruder'],
      evil: bundles['evil'],
    },
    initial: 'tip-splitter',
    channel: 'b',
    showDiagnostics: false,
    autostart: true,
  });
  await mkdir(r('src/runtime/generated'), { recursive: true });
  await writeFile(
    r('src/runtime/generated/runtime-html.ts'),
    '// AUTO-GENERATED by build/build.mjs — do not edit. Run `npm run build` to regenerate.\n' +
    '// The self-contained WebView document: a cross-origin sandboxed iframe under the locked\n' +
    '// #35 CSP, channel-(b) delivery of the tip-splitter bundle, diagnostics off (full-screen iframe).\n' +
    '/* eslint-disable */\n' +
    'export const RUNTIME_HTML = ' + JSON.stringify(RUNTIME_HTML) + ';\n',
  );

  // Artifacts for the invariant suite (it generates scenario pages against THIS runtime).
  await writeFile(
    r('src/runtime/generated/runtime-artifacts.json'),
    JSON.stringify({ parts, bundles, appRecords }, null, 0),
  );

  // Host-side app records (capability-bridge): the WebView host reads these to launch an app's
  // engine + bind its realm (manifest + schema) before delivering the bundle (D7).
  await writeFile(
    r('src/runtime/generated/app-records.ts'),
    '// AUTO-GENERATED by build/build.mjs — do not edit. Run `npm run build` to regenerate.\n' +
    '// Host-held app records (capability-bridge D4/D7): the manifest the gate enforces and the\n' +
    '// schema the engine opens, extracted from each fixture\'s own defineApp declaration.\n' +
    '/* eslint-disable */\n' +
    "import type { AppRecord } from '../../host/bridge/contract';\n" +
    'export const APP_RECORDS: Record<string, AppRecord> = ' + JSON.stringify(appRecords, null, 2) + ';\n',
  );

  // Fixture bundle SOURCES for the RN side (launcher-shell / #5 D7). First-run seeding needs the
  // IIFE source on-device to snapshot it into the version store; today that source exists only
  // inside RUNTIME_HTML's baked map. Same strings, exposed to RN. The launcher delivers these
  // by-source (D3); seeding installs tip-splitter + water-counter from here.
  await writeFile(
    r('src/runtime/generated/app-bundles.ts'),
    '// AUTO-GENERATED by build/build.mjs — do not edit. Run `npm run build` to regenerate.\n' +
    '// Fixture name → IIFE bundle source (launcher-shell #5 D7): the RN side reads these to seed\n' +
    '// the version store and to deliver installed apps by source. Same bytes as the baked map.\n' +
    '/* eslint-disable */\n' +
    'export const APP_BUNDLES: Record<string, string> = ' + JSON.stringify(bundles, null, 0) + ';\n',
  );

  console.log(
    `  RUNTIME_HTML ${(RUNTIME_HTML.length / 1024).toFixed(0)} KiB → src/runtime/generated/runtime-html.ts`,
  );
  console.log('Whim build: done.');
}

main().catch((e) => { console.error('BUILD FAILED:', e); process.exit(1); });
