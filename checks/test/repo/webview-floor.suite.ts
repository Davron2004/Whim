/**
 * The WebView floor over everything that runs in the sandboxed WebView: every part of the emitted
 * runtime (React, the vc-sdk inject with the design tokens it bundles, the sandbox's own scripts),
 * every fixture bundle the app ships, and every fixture source. esbuild lowers syntax to the floor
 * but never polyfills a built-in, so a post-floor call anywhere here renders on a current phone and
 * throws a TypeError on an Android 10 WebView. Scans the build output, so `npm run build` must run
 * first (the gate does).
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { test, assert } from '../harness';
import { WEBVIEW_FLOOR_CHROMIUM } from '../../contract';
import { buildContext } from '../../internal/scope';
import { findPostFloorBuiltins } from '../../passes/webview-floor';

const ROOT = process.cwd();
const ARTIFACTS = path.join(ROOT, 'src/runtime/generated/runtime-artifacts.json');

interface RuntimeArtifacts {
  parts: Record<string, string>;
  bundles: Record<string, string>;
}

/** `file: symbol (Chromium n) at line:column` for each post-floor use in `text`. */
function usesIn(file: string, text: string, kind: ts.ScriptKind): string[] {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const ctx = buildContext(text, sourceFile, () => undefined, undefined);
  return findPostFloorBuiltins(ctx).map((u) => `${file}: ${u.symbol} (Chromium ${u.builtin.chromium}) at ${u.line}:${u.column}`);
}

export async function run(): Promise<void> {
  await test(`webview-floor: the emitted runtime and fixture bundles use no built-in newer than Chromium ${WEBVIEW_FLOOR_CHROMIUM}`, () => {
    assert(fs.existsSync(ARTIFACTS), `${path.relative(ROOT, ARTIFACTS)} is missing: run \`npm run build\` first`);
    const { parts, bundles } = JSON.parse(fs.readFileSync(ARTIFACTS, 'utf8')) as RuntimeArtifacts;
    const scripts = [...Object.entries(parts).map(([n, js]) => [`part ${n}`, js]), ...Object.entries(bundles).map(([n, js]) => [`bundle ${n}`, js])];
    assert(scripts.length > 0 && 'sdkInject' in parts && 'reactInject' in parts, 'runtime-artifacts.json has no SDK/React parts to scan');
    const hits = scripts.flatMap(([name, js]) => usesIn(name, js, ts.ScriptKind.JS));
    assert(hits.length === 0, `post-floor built-ins in the WebView runtime (throw a TypeError on Chromium ${WEBVIEW_FLOOR_CHROMIUM}):\n  ${hits.join('\n  ')}`);
  });

  await test(`webview-floor: no fixture source uses a built-in newer than Chromium ${WEBVIEW_FLOOR_CHROMIUM}`, () => {
    const dir = path.join(ROOT, 'fixtures');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.app.tsx'));
    assert(files.length > 0, 'no fixtures/*.app.tsx found');
    const hits = files.flatMap((f) => usesIn(`fixtures/${f}`, fs.readFileSync(path.join(dir, f), 'utf8'), ts.ScriptKind.TSX));
    assert(hits.length === 0, `post-floor built-ins in fixtures:\n  ${hits.join('\n  ')}`);
  });
}
