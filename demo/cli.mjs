#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// demo/cli.mjs — runs a compiled flow file against the stage and writes an .mp4.
//
//   node demo/cli.mjs <flow-file.mjs> [--out <dir>]
//
// The flow file's default export is `async ({ stage }) => { ... }` — see demo/lib/stage.mjs
// for the director API and demo/flows/tip-splitter.demo.mjs for a worked example.
import { resolve, basename, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStage } from './lib/stage.mjs';

function parseArgs(argv) {
  const rest = [];
  let out;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') {
      out = argv[i + 1];
      i++;
    } else {
      rest.push(argv[i]);
    }
  }
  if (rest.length !== 1) {
    console.error('usage: node demo/cli.mjs <flow-file.mjs> [--out <dir>]');
    process.exit(1);
  }
  return { flowArg: rest[0], outDir: out ? resolve(out) : undefined };
}

async function main() {
  const { flowArg, outDir } = parseArgs(process.argv.slice(2));
  const flowPath = resolve(flowArg);
  // "tip-splitter.demo.mjs" → "tip-splitter" (the video's base filename).
  const flowName = basename(flowPath, extname(flowPath)).replace(/\.demo$/, '');

  let flow;
  try {
    const mod = await import(pathToFileURL(flowPath).href);
    flow = mod.default;
  } catch (err) {
    console.error(`Could not load flow file ${flowPath}:\n${err && err.stack ? err.stack : err}`);
    process.exit(1);
  }
  if (typeof flow !== 'function') {
    console.error(`Flow file ${flowPath} must have a default export: async ({ stage }) => { ... }`);
    process.exit(1);
  }

  const stage = await createStage({ flowName, ...(outDir ? { outDir } : {}) });
  try {
    await flow({ stage });
    const outPath = await stage.finish();
    console.log(`\nDemo video written: ${outPath}`);
  } catch (err) {
    console.error(`\nDemo flow "${flowName}" failed:\n${err && err.stack ? err.stack : err}`);
    await stage.abort();
    process.exit(1);
  }
}

main();
