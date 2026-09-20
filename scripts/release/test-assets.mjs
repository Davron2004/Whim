// Real Chromium generation regression, kept separate from the fast, browser-free checks suite.
// Run: node scripts/release/test-assets.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = process.cwd();
const outfile = path.join(root, `.asset-generation.${process.pid}.tmp.mjs`);
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-generate-assets-'));
try {
  await build({ stdin: { contents: "export * from './scripts/release/lib/assets'; export { decodeRgba8 } from './scripts/release/lib/png';", resolveDir: root, loader: 'ts' }, outfile, bundle: true, platform: 'node', format: 'esm', tsconfigRaw: '{}', external: ['playwright'] });
  const { generateAssets, checkAssets, decodeRgba8, ICON_FOREGROUND_PNG_PATH, ICON_FOREGROUND_SVG_PATH, GENERATED_JSON_PATH } = await import(pathToFileURL(outfile));
  fs.cpSync(path.join(root, 'release/assets'), path.join(fixture, 'release/assets'), { recursive: true });
  const png = fs.readFileSync(path.join(root, 'release/store/play/en-US/images/icon.png'));
  fs.writeFileSync(path.join(fixture, ICON_FOREGROUND_PNG_PATH), png);
  fs.rmSync(path.join(fixture, ICON_FOREGROUND_SVG_PATH));
  await generateAssets(fixture);
  const generated = JSON.parse(fs.readFileSync(path.join(fixture, GENERATED_JSON_PATH), 'utf8'));
  assert.deepEqual(generated.source, { path: ICON_FOREGROUND_PNG_PATH, sha256: crypto.createHash('sha256').update(png).digest('hex') });
  assert.deepEqual(checkAssets(fixture), []);
  // This opaque 512px input is drawn 1:1 into the Play icon. Inspect actual rendered pixels,
  // so a broken image yielding a valid, hashed background-only PNG cannot pass.
  const renderedIcon = fs.readFileSync(path.join(fixture, 'release/store/play/en-US/images/icon.png'));
  assert.deepEqual(decodeRgba8(renderedIcon).pixels, decodeRgba8(png).pixels);
  fs.copyFileSync(path.join(root, ICON_FOREGROUND_SVG_PATH), path.join(fixture, ICON_FOREGROUND_SVG_PATH));
  await assert.rejects(generateAssets(fixture), /exactly one foreground/);
  fs.rmSync(path.join(fixture, ICON_FOREGROUND_SVG_PATH));
  fs.rmSync(path.join(fixture, ICON_FOREGROUND_PNG_PATH));
  await assert.rejects(generateAssets(fixture), /no foreground source/);
  console.log('PASS: Chromium generated all PNG-source outputs, recorded source hash, and rejected missing/ambiguous inputs');
} finally {
  fs.rmSync(outfile, { force: true });
  fs.rmSync(fixture, { recursive: true, force: true });
}
