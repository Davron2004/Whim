import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, 'src', 'flowbench', 'drive.ts');
const outfile = path.join(here, `.flowbench-driver.${process.pid}.tmp.mjs`);

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'warning',
});

let exitCode = 2;
try {
  const drive = await import(pathToFileURL(outfile));
  const args = drive.parseArgs(process.argv.slice(2));
  const report = await drive.runFlowBenchmark(args);
  if (args.jsonPath) drive.writeJsonReport(report, args.jsonPath);
  process.stdout.write(drive.formatMarkdownReport(report));
  exitCode = report.summary.failures === 0 ? 0 : 1;
} catch (error) {
  console.error(`flowbench.mjs: ${error instanceof Error ? error.message : String(error)}`);
  exitCode = 2;
} finally {
  fs.rmSync(outfile, { force: true });
}
process.exit(exitCode);
