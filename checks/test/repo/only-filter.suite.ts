/**
 * `--only <pattern>` on the Node suite runners (`scripts/lib/only-filter.mjs`): a filter that keeps
 * the matching suites whole, FAILS when it matches nothing or runs nothing (never a vacuous pass),
 * and leaves a bare run exactly as it was. The runner cases spawn the real bridge and checks
 * runners, so the filter is judged on what a red-check will actually see.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, assert } from '../harness';
import { parseOnly, filterSource } from '../../../scripts/lib/only-filter.mjs';
import { ONLY_ENV } from '../../../scripts/lib/only-ran.mjs';

const ROOT = process.cwd();

const ENTRY = `
import { report, test } from './harness';
import { runAlphaTests } from './alpha.suite';
import { runBetaTests } from './beta.suite';
import { testGamma } from './gamma';

async function testSweepReach() {}
const h = report();
await runAlphaTests(h);
await runBetaTests(h);
async function main() {
  await testGamma();
  await testSweepReach();
  await test('delta: a title', () => {
    runAlphaTests(h);
  });
  await test('epsilon: another title', () => {});
}
`;

/** The shape of checks/test/acceptance.ts: suites declared in the entry, each a run of titled tests. */
const LOCAL_SUITES = `
import { test } from './harness';

async function testScanner(): Promise<void> {
  await test('scanner: first', () => {});
  await test('scanner: second', () => {});
}

async function testAllowlist(): Promise<void> {
  await test('imports: bare', () => {});
  await test('imports: relative', () => {});
}

async function main() {
  await testScanner();
  await testAllowlist();
  await test('top: a loose title', () => {});
}
`;

/** Env for a spawned runner: the outer run's `--only` flag must not leak into an unfiltered child. */
function childEnv(armed = false): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env[ONLY_ENV];
  if (armed) env[ONLY_ENV] = '1';
  return env;
}

function runNode(args: string[], input?: string, env: NodeJS.ProcessEnv = childEnv()): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', input, env });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

function runBridge(...args: string[]): { status: number | null; out: string } {
  return runNode(['src/host/bridge/test/run.mjs', ...args]);
}

/** The titles of the `test('...')` calls in the body of the entry-declared suite `fnName`. */
function titlesOf(source: string, fnName: string): string[] {
  const start = source.indexOf(`async function ${fnName}(`);
  const end = source.indexOf('\nasync function ', start + 1);
  return [...source.slice(start, end).matchAll(/await test\(\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
}

/** `report()` of a harness module, called after zero tests ran, as a node process; returns its exit status. */
function emptyReportStatus(harnessModule: string, onlyArmed: boolean): number | null {
  const entry = `import * as h from ${JSON.stringify(path.join(ROOT, harnessModule))}; const r = h.report(); process.exit(typeof r === 'object' ? r.exitCode : 0);`;
  const bundle = spawnSync(path.join(ROOT, 'node_modules/.bin/esbuild'), ['--bundle', '--platform=node', '--format=esm', '--loader=ts', '--tsconfig-raw={}', '--log-level=error'], { cwd: ROOT, encoding: 'utf8', input: entry });
  assert(bundle.status === 0, `bundling ${harnessModule}: ${bundle.stderr}`);
  return runNode(['--input-type=module', '-'], bundle.stdout, childEnv(onlyArmed)).status;
}

export async function run(): Promise<void> {
  await test('only-filter: --only is read repeated, comma-separated and as --only=x; absent is null', () => {
    const armed = process.env[ONLY_ENV];
    assert(JSON.stringify(parseOnly(['--only', 'a,b', '--only=c', '--only', 'd'])) === '["a","b","c","d"]', 'all four forms are collected in order');
    assert(parseOnly([]) === null, 'no --only is null, so the runner filters nothing');
    assert(parseOnly(['--verbose']) === null, 'other flags are not --only');
    assert(process.env[ONLY_ENV] === '1', 'reading --only arms the "ran nothing" backstop for the suite reports');
    if (armed === undefined) delete process.env[ONLY_ENV];
    else process.env[ONLY_ENV] = armed;
  });

  await test('only-filter: a suite call whose module does not match is removed; harness calls stay', async () => {
    const r = await filterSource(ENTRY, ['alpha']);
    assert(JSON.stringify(r.kept) === '["alpha.suite"]', `kept ${JSON.stringify(r.kept)}`);
    assert(r.code.includes('runAlphaTests(h)'), 'the matching suite call is kept');
    assert(!r.code.includes('await runBetaTests(h)'), 'the non-matching suite call is removed');
    assert(!r.code.includes('testGamma()'), 'a test-prefixed suite function that does not match is removed');
    assert(r.code.includes('report()'), 'harness plumbing is never removed');
    assert(r.code.includes("import { runBetaTests } from './beta.suite'"), 'imports are left in place');
  });

  await test('only-filter: a test title matches too, case-insensitively, and patterns are a union', async () => {
    const r = await filterSource(ENTRY, ['EPSILON', 'beta']);
    assert(JSON.stringify(r.kept) === '["beta.suite","epsilon: another title"]', `kept ${JSON.stringify(r.kept)}`);
    assert(JSON.stringify(r.dropped) === '["alpha.suite","gamma","testSweepReach","delta: a title"]', `dropped ${JSON.stringify(r.dropped)}`);
  });

  await test('only-filter: a function declared in the entry is a suite, found by its name with punctuation ignored', async () => {
    const r = await filterSource(ENTRY, ['sweep-reach']);
    assert(JSON.stringify(r.kept) === '["testSweepReach"]', `kept ${JSON.stringify(r.kept)}`);
    assert(r.code.includes('await testSweepReach();') && !r.code.includes('testGamma();'), 'the local suite call is kept and the others are not');
    assert((await filterSource(ENTRY, ['delta'])).code.includes('runAlphaTests(h);\n  });'), 'a suite call inside a kept test body is never filtered');
    assert((await filterSource(ENTRY, ['---'])).kept.length === 0, 'a pattern of only punctuation matches nothing');
  });

  await test('only-filter: a kept local suite runs its whole body, whichever of its name or titles the pattern hit', async () => {
    for (const pattern of ['scanner', 'second']) {
      const r = await filterSource(LOCAL_SUITES, [pattern]);
      assert(JSON.stringify(r.kept) === '["testScanner"]', `--only ${pattern} kept ${JSON.stringify(r.kept)}`);
      assert(r.code.includes("await test('scanner: first'") && r.code.includes("await test('scanner: second'"), `--only ${pattern} left the suite body intact`);
      assert(r.code.includes('await testScanner();'), `--only ${pattern} kept the suite call`);
      assert(!r.code.includes('await testAllowlist();'), `--only ${pattern} dropped the other suite call`);
    }
  });

  await test('only-filter: a title inside a local suite keeps the call that runs it, not an emptied call or a dropped one', async () => {
    const r = await filterSource(LOCAL_SUITES, ['imports']);
    assert(JSON.stringify(r.kept) === '["testAllowlist"]', `kept ${JSON.stringify(r.kept)}`);
    assert(r.code.includes('await testAllowlist();'), 'the call to the suite holding the matching titles is kept');
    assert(r.code.includes("await test('imports: bare'") && r.code.includes("await test('imports: relative'"), 'both titles of that suite survive');
    assert(!r.code.includes('await testScanner();'), 'the unrelated suite call is dropped');
    assert(!r.code.includes("await test('top: a loose title'"), 'a loose top-level title that does not match is dropped');
  });

  await test('only-filter: the real checks entry keeps StorageSurfaceScanner whole and imports/screens/capabilities keep their suites', async () => {
    const source = readFileSync(path.join(ROOT, 'checks/test/acceptance.ts'), 'utf8');
    const scanner = titlesOf(source, 'testStorageSurfaceScanner');
    assert(scanner.length > 0, 'the real suite has titled tests');
    const kept = await filterSource(source, ['StorageSurfaceScanner']);
    assert(kept.kept.includes('testStorageSurfaceScanner') && kept.code.includes('await testStorageSurfaceScanner();'), 'the suite call is kept');
    for (const title of scanner) assert(kept.code.includes(title), `the body still holds "${title}"`);
    for (const [pattern, fn] of [['imports', 'testImportAllowlist'], ['screens', 'testScreenGraph'], ['capabilities', 'testCapabilityDirections']]) {
      const r = await filterSource(source, [pattern]);
      assert(r.code.includes(`await ${fn}();`), `--only ${pattern} keeps the call to ${fn}, whose titles it matched`);
    }
  });

  await test('only-filter: a pattern that matches nothing keeps nothing', async () => {
    const r = await filterSource(ENTRY, ['no-such-suite']);
    assert(r.kept.length === 0 && r.dropped.length === 6, `kept ${r.kept.length}, dropped ${r.dropped.length}`);
  });

  await test('only-filter: a real runner runs only the matching test, and a pattern matching nothing fails it', () => {
    // Titles in src/host/bridge/test/acceptance.ts (§G4, §G5): rename them there and here together.
    const one = runBridge('--only', '§G4');
    assert(one.status === 0, `--only §G4 exited ${one.status}: ${one.out}`);
    assert(one.out.includes('§G4') && !one.out.includes('§G5'), 'only the §G4 test ran');

    const none = runBridge('--only', 'no-such-suite');
    assert(none.status !== 0, 'a pattern matching nothing exits non-zero');
    assert(none.out.includes('no suite matched'), `the failure says why: ${none.out}`);
    assert(!none.out.includes('checks passed'), 'nothing was run');
  });

  await test('only-filter: each pattern must match a suite: one typo in a list fails the run, naming the typo, while the rest of the list still matches', async () => {
    const typo = await filterSource(ENTRY, ['alpha', 'obsrvrs']);
    assert(JSON.stringify(typo.kept) === '["alpha.suite"]' && JSON.stringify(typo.unmatched) === '["obsrvrs"]', `kept ${JSON.stringify(typo.kept)}, unmatched ${JSON.stringify(typo.unmatched)}`);
    assert((await filterSource(ENTRY, ['alpha', 'EPSILON'])).unmatched.length === 0, 'a list whose every pattern matches has no unmatched pattern');

    const listed = runBridge('--only', '§G4,no-such-suite');
    assert(listed.status !== 0, `--only §G4,no-such-suite exited ${listed.status}, though one pattern matched nothing`);
    assert(listed.out.includes('no suite matched --only no-such-suite (the other patterns did)'), `the failure names the typo: ${listed.out}`);
    assert(!listed.out.includes('checks passed'), 'nothing was run');
  });

  await test('only-filter: the real checks runner with --only StorageSurfaceScanner runs that suite\'s tests', () => {
    const source = readFileSync(path.join(ROOT, 'checks/test/acceptance.ts'), 'utf8');
    const titles = titlesOf(source, 'testStorageSurfaceScanner');
    const r = runNode(['checks/test/run.mjs', '--only', 'StorageSurfaceScanner']);
    assert(r.status === 0, `exited ${r.status}: ${r.out}`);
    for (const title of titles) assert(r.out.includes(title), `"${title}" ran`);
    assert(/PASS [1-9]\d* · FAIL 0/.test(r.out), `the summary counts the tests: ${r.out}`);
  });

  await test('only-filter: a --only run that executed no test fails, in each harness that reports', () => {
    for (const harness of ['checks/test/harness.ts', 'server/test/harness.ts']) {
      assert(emptyReportStatus(harness, true) === 1, `${harness}: an armed --only run with 0 tests exits non-zero`);
      assert(emptyReportStatus(harness, false) === 0, `${harness}: the same empty report without --only is unchanged`);
    }
  });

  await test('only-filter: the bridge runner, wired to the backstop directly, fails a --only run whose kept test counted no check', () => {
    // The bridge's own acceptance entry, filtered to one test with its check counter removed: the
    // shape of a filter that kept something that executes nothing. It bundles from the entry's own
    // directory, which is where stdin's relative imports resolve.
    const dir = path.join(ROOT, 'src/host/bridge/test');
    const source = readFileSync(path.join(dir, 'acceptance.ts'), 'utf8');
    assert(source.includes('passed++;'), 'the bridge counts its checks with passed++ (rename it here and there together)');
    const probe = async (counting: boolean): Promise<{ status: number | null; out: string }> => {
      const kept = (await filterSource(source, ['§G4'], 'acceptance.ts')).code;
      const entry = counting ? kept : kept.replace('passed++;', '');
      const bundle = spawnSync(path.join(ROOT, 'node_modules/.bin/esbuild'), ['--bundle', '--platform=node', '--format=esm', '--loader=ts', '--tsconfig-raw={}', '--log-level=error', '--sourcefile=acceptance.ts'], { cwd: dir, encoding: 'utf8', input: entry });
      assert(bundle.status === 0, `bundling the bridge probe: ${bundle.stderr}`);
      return runNode(['--input-type=module', '-'], bundle.stdout, childEnv(true));
    };
    return probe(true).then(async (counted) => {
      assert(counted.status === 0, `control: the same filtered run with its checks counted exited ${counted.status}: ${counted.out}`);
      const uncounted = await probe(false);
      assert(uncounted.status === 1, `an armed --only run with no counted check exited ${uncounted.status}`);
      assert(uncounted.out.includes('executed 0 tests'), `and says why: ${uncounted.out}`);
    });
  });

  await test('only-filter: without --only the runner runs every test, as before', () => {
    const all = runBridge();
    assert(all.status === 0, `exited ${all.status}: ${all.out}`);
    assert(all.out.includes('§A duplicate registration') && all.out.includes('§G8'), 'first and last tests both ran');
  });
}
