/**
 * The load-test driver CLI (design D26), run by `deploy/loadtest/run.sh drive` from the operator's
 * machine against a deployed load-test server:
 *
 *   node server/loadtest.mjs --target <https url> --devices <N> --cap <C> --queue-max <Q> [--json <file>] [--stats <file>]
 *
 * Mirrors `server/dev.mjs`'s bundle-then-import idiom rather than importing `src/loadtest/drive.ts`
 * directly, so this stays a plain Node script with no project-wide `ts-node`/loader dependency. All
 * the actual logic (SSE framing, device driving, the leak probe, the report, the exit rule) is
 * `src/loadtest/drive.ts`, independently exercised by `server/test/loadtest.suite.ts` (pure pieces)
 * and `server/test/e2e.ts` (against a live in-process load-test server).
 */
import { build } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, 'src', 'loadtest', 'drive.ts');
const outfile = path.join(here, `.loadtest-driver.${process.pid}.tmp.mjs`);

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'warning',
});

let exitCode = 1;
try {
  const drive = await import(pathToFileURL(outfile));
  const args = drive.parseArgs(process.argv.slice(2));
  console.error(`==> driving ${args.devices} device(s) against ${args.target} (cap ${args.cap}, line ${args.queueMax})`);
  const outcomes = await drive.runDevices(args.target, args.devices);
  console.error('==> leak probe');
  const leak = await drive.leakProbe(args.target, args.cap);
  const peak = drive.readPeakStats(args.statsPath);
  const cpu = drive.readCpuReport(args.statsPath);
  const report = drive.buildReport(args.devices, args.cap, args.queueMax, outcomes, leak, peak, cpu);
  const verdict = drive.verdict(report);
  if (cpu) {
    console.error(
      `==> cpu: ${cpu.cores} core(s), ${cpu.samples} sample(s), normalized p50 ${cpu.p50Percent.toFixed(1)}% ` +
        `p95 ${cpu.p95Percent.toFixed(1)}% peak ${cpu.peakPercent.toFixed(1)}% (raw peak ${peak?.peakCpuPercent.toFixed(1) ?? 'n/a'}%)`,
    );
  }
  const output = JSON.stringify({ ...report, verdict }, null, 2);
  console.log(output);
  if (args.jsonPath) fs.writeFileSync(args.jsonPath, output);
  exitCode = verdict.ok ? 0 : 1;
} catch (err) {
  console.error(`loadtest.mjs: ${err instanceof Error ? err.message : String(err)}`);
  exitCode = 1;
} finally {
  fs.rmSync(outfile, { force: true });
}
process.exit(exitCode);
