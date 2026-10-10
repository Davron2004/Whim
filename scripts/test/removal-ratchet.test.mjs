#!/usr/bin/env node
// Suite for scripts/removal-ratchet.mjs (GitHub #159). Every case builds a throwaway git repo under
// mktemp, commits a base, applies a change and runs the REAL script in that repo. Framework-free,
// house idiom: assert + a test() wrapper, exit non-zero on the first failure.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'removal-ratchet.mjs');
const PREFIX = 'whim-ratchet-';

let pass = 0;
async function test(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log('PASS:', name);
  } catch (e) {
    console.error('FAIL:', name, '\n', (e && e.stack) || e);
    process.exit(1);
  }
}

// The caller's environment must not steer the fixture repos (#155: GATE_BASE leaked into a nested gate).
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k === 'GATE_BASE' || k.startsWith('GIT_')) delete env[k];
  return { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', ...extra };
}

function git(repo, args) {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- intentional: the suite runs inside the repo's own dev/CI toolchain, which always has trustworthy `git` and `node` on PATH
  const r = spawnSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
    cwd: repo, encoding: 'utf8', env: cleanEnv(),
  });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function write(repo, file, text) {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), text);
}

function commit(repo, message) {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', message]);
  return git(repo, ['rev-parse', 'HEAD']);
}

// Throwaway repos live under mktemp only; remove exactly those, even when a case fails.
const TMPS = [];
process.on('exit', () => {
  for (const dir of TMPS) {
    if (path.dirname(dir) === fs.realpathSync(os.tmpdir()) && path.basename(dir).startsWith(PREFIX)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});
function fixture(files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), PREFIX)));
  TMPS.push(dir);
  git(dir, ['init', '-q', '-b', 'main']);
  for (const [f, text] of Object.entries(files)) write(dir, f, text);
  const base = commit(dir, 'base');
  return { dir, base };
}

function ratchet(repo, { base, env = {}, args = [] } = {}) {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- intentional: the suite runs inside the repo's own dev/CI toolchain, which always has trustworthy `git` and `node` on PATH
  const r = spawnSync('node', [SCRIPT, ...args], {
    cwd: repo, encoding: 'utf8', env: cleanEnv(base ? { GATE_BASE: base, ...env } : env),
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

// ---- fixtures ------------------------------------------------------------------------------------
const SUITE = 'checks/test/sample.suite.ts';
const SUITE_TEXT = `import nodeAssert from 'node:assert';
test('first', () => {
  nodeAssert.strictEqual(1, 1);
  nodeAssert.ok(true, 'second assertion');
});
test('second', () => {
  nodeAssert.deepStrictEqual([1], [1]);
});
`; // 3 assertions, 2 tests

const SH = 'scripts/test/sample.test.sh';
const SH_TEXT = `#!/usr/bin/env bash
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; exit 1; }
assert_contains() { grep -q "$2" <<<"$1" && pass "$3" || fail "$3"; }
case_one() {
  assert_contains "abc" "b" "has b"
  assert_contains "abc" "c" "has c"
}
case_one
`; // assertions: pass + fail + 2 assert_contains calls + 1 inside the helper = 5; tests: case_one() + its call = 2

const BASE_FILES = { [SUITE]: SUITE_TEXT, 'src/product.ts': 'export const x = 1;\n' };

// ---- additions and non-removals pass -------------------------------------------------------------
await test('pure addition passes: a new file, a new test, a new assertion', async () => {
  const { dir, base } = fixture(BASE_FILES);
  write(dir, SUITE, `${SUITE_TEXT}test('third', () => { nodeAssert.ok(1); nodeAssert.ok(2); });\n`);
  write(dir, 'checks/test/new.suite.ts', "test('n', () => { nodeAssert.ok(1); });\n");
  commit(dir, 'add checks');
  const r = ratchet(dir, { base });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /PASS/);
});

await test('a reworded assertion that keeps the count passes', async () => {
  const { dir, base } = fixture(BASE_FILES);
  write(dir, SUITE, SUITE_TEXT.replace('nodeAssert.strictEqual(1, 1);', 'nodeAssert.equal(Number("1"), 1);'));
  commit(dir, 'reword');
  assert.equal(ratchet(dir, { base }).code, 0);
});

await test('editing a string literal or comment that mentions an assertion changes nothing', async () => {
  const { dir, base } = fixture(BASE_FILES);
  write(dir, SUITE, `// nodeAssert.ok(a) is the one to use\n${SUITE_TEXT.replace("'second assertion'", "'nodeAssert.ok(x) in prose'")}`);
  commit(dir, 'prose');
  assert.equal(ratchet(dir, { base }).code, 0);
});

await test('product code and fixtures are not verification code', async () => {
  const { dir, base } = fixture({ ...BASE_FILES, 'checks/test/fixtures/sample.ts': 'nodeAssert.ok(1);\n' });
  fs.rmSync(path.join(dir, 'src/product.ts'));
  fs.rmSync(path.join(dir, 'checks/test/fixtures/sample.ts'));
  commit(dir, 'drop non-verification files');
  assert.equal(ratchet(dir, { base }).code, 0);
});

// ---- removals fail --------------------------------------------------------------------------------
await test('a deleted verification file fails and is named', async () => {
  const { dir, base } = fixture(BASE_FILES);
  fs.rmSync(path.join(dir, SUITE));
  commit(dir, 'delete the suite');
  const r = ratchet(dir, { base });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /checks\/test\/sample\.suite\.ts: deleted \(was 3 assertions, 2 tests\)/);
  assert.match(r.out, /Check-removal: <why this check is no longer needed>/);
});

await test('a dropped assertion fails with before and after counts', async () => {
  const { dir, base } = fixture(BASE_FILES);
  write(dir, SUITE, SUITE_TEXT.replace("  nodeAssert.ok(true, 'second assertion');\n", ''));
  commit(dir, 'drop an assertion');
  const r = ratchet(dir, { base });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /sample\.suite\.ts: assertions 3 -> 2, tests 2 -> 2/);
});

await test('a commented-out assertion counts as removed', async () => {
  const { dir, base } = fixture(BASE_FILES);
  write(dir, SUITE, SUITE_TEXT.replace("  nodeAssert.ok(true, 'second assertion');", "  // nodeAssert.ok(true, 'second assertion');"));
  commit(dir, 'comment it out');
  const r = ratchet(dir, { base });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /assertions 3 -> 2/);
});

await test('an assertion turned into a string literal counts as removed', async () => {
  const { dir, base } = fixture(BASE_FILES);
  write(dir, SUITE, SUITE_TEXT.replace("nodeAssert.ok(true, 'second assertion');", "const s = 'nodeAssert.ok(true)';"));
  commit(dir, 'stringify it');
  assert.equal(ratchet(dir, { base }).code, 1);
});

await test('a dropped test declaration fails even when the assertion count is unchanged', async () => {
  const { dir, base } = fixture(BASE_FILES);
  write(dir, SUITE, SUITE_TEXT.replace("test('second', () => {\n  nodeAssert.deepStrictEqual([1], [1]);\n});\n", "nodeAssert.deepStrictEqual([1], [1]);\n"));
  commit(dir, 'inline a test');
  const r = ratchet(dir, { base });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /assertions 3 -> 3, tests 2 -> 1/);
});

await test('a deleted static-check detector under checks/ fails (deletion only)', async () => {
  const { dir, base } = fixture({ ...BASE_FILES, 'checks/passes/a.ts': 'export const a = 1;\n' });
  write(dir, 'checks/passes/a.ts', 'export const a = 2;\n'); // editing a detector is free
  commit(dir, 'edit detector');
  assert.equal(ratchet(dir, { base }).code, 0);
  fs.rmSync(path.join(dir, 'checks/passes/a.ts'));
  commit(dir, 'delete detector');
  const r = ratchet(dir, { base });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /checks\/passes\/a\.ts: deleted/);
});

await test('a rename keeps its counts and passes; a rename that drops one fails', async () => {
  const { dir, base } = fixture(BASE_FILES);
  git(dir, ['mv', SUITE, 'checks/test/renamed.suite.ts']);
  commit(dir, 'rename');
  assert.equal(ratchet(dir, { base }).code, 0);
  write(dir, 'checks/test/renamed.suite.ts', SUITE_TEXT.replace("  nodeAssert.ok(true, 'second assertion');\n", ''));
  commit(dir, 'rename then drop');
  const r = ratchet(dir, { base });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /renamed\.suite\.ts: assertions 3 -> 2/);
});

// ---- the trailer ----------------------------------------------------------------------------------
await test('a removal passes when a commit that touches the file carries Check-removal: <reason>', async () => {
  const { dir, base } = fixture(BASE_FILES);
  fs.rmSync(path.join(dir, SUITE));
  commit(dir, 'drop the suite\n\nThe feature is gone.\n\nCheck-removal: the screen it covered was deleted');
  const r = ratchet(dir, { base });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /authorised: checks\/test\/sample\.suite\.ts: deleted .* Check-removal: the screen it covered was deleted/);
});

await test('a trailer on a commit that does not touch the file does not authorise it', async () => {
  const { dir, base } = fixture(BASE_FILES);
  write(dir, 'docs/note.md', 'note\n');
  commit(dir, 'unrelated\n\nCheck-removal: nothing to do with the suite');
  fs.rmSync(path.join(dir, SUITE));
  commit(dir, 'delete the suite');
  const r = ratchet(dir, { base });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /no commit in the branch that touches this file/);
});

await test('a trailer covers only the files its commit touches', async () => {
  const { dir, base } = fixture({ ...BASE_FILES, 'checks/test/other.suite.ts': SUITE_TEXT });
  fs.rmSync(path.join(dir, SUITE));
  commit(dir, 'drop one\n\nCheck-removal: obsolete');
  fs.rmSync(path.join(dir, 'checks/test/other.suite.ts'));
  commit(dir, 'drop two');
  const r = ratchet(dir, { base });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /other\.suite\.ts: deleted/);
  assert.doesNotMatch(r.out, /FAIL[^]*sample\.suite\.ts: deleted/);
});

await test('an empty reason does not authorise', async () => {
  const { dir, base } = fixture(BASE_FILES);
  fs.rmSync(path.join(dir, SUITE));
  commit(dir, 'drop the suite\n\nCheck-removal:');
  const r = ratchet(dir, { base });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /reason is empty/);
});

await test('prose that mentions the trailer outside the trailer block does not authorise', async () => {
  const { dir, base } = fixture(BASE_FILES);
  fs.rmSync(path.join(dir, SUITE));
  commit(dir, 'drop the suite\n\nCheck-removal: this sentence is inside the prose paragraph.\nSo it is not a trailer block.\nAnd it goes on.\n\nSigned off by nobody.');
  const r = ratchet(dir, { base });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /no commit in the branch that touches this file carries/);
});

await test('an uncommitted removal fails and says to commit it with the trailer', async () => {
  const { dir, base } = fixture(BASE_FILES);
  write(dir, SUITE, `${SUITE_TEXT}test('x', () => { nodeAssert.ok(1); });\n`);
  commit(dir, 'add a test\n\nCheck-removal: an earlier, unrelated authorisation on the same file');
  fs.rmSync(path.join(dir, SUITE));
  const r = ratchet(dir, { base });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /uncommitted changes; commit it with a "Check-removal: <reason>" trailer/);
});

// ---- shell tests ----------------------------------------------------------------------------------
await test('shell: a commented-out assertion, and one moved into a heredoc, count as removed', async () => {
  const { dir, base } = fixture({ [SH]: SH_TEXT });
  write(dir, SH, SH_TEXT.replace('  assert_contains "abc" "c" "has c"', '  # assert_contains "abc" "c" "has c"'));
  commit(dir, 'comment out');
  const a = ratchet(dir, { base });
  assert.equal(a.code, 1, a.out);
  write(dir, SH, SH_TEXT.replace('  assert_contains "abc" "c" "has c"', "  cat <<'EOF'\n  assert_contains \"abc\" \"c\" \"has c\"\nEOF"));
  commit(dir, 'heredoc');
  assert.equal(ratchet(dir, { base }).code, 1);
});

await test('shell: rewording the arguments keeps the count and a dropped case function fails', async () => {
  const { dir, base } = fixture({ [SH]: SH_TEXT });
  write(dir, SH, SH_TEXT.replace('"has c"', '"contains the letter c"'));
  commit(dir, 'reword');
  assert.equal(ratchet(dir, { base }).code, 0);
  write(dir, SH, SH_TEXT.replace('case_one() {', 'helper_one() {'));
  commit(dir, 'rename the case');
  const r = ratchet(dir, { base });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /tests 2 -> 1/);
});

// ---- the vocabulary: dropping any one form is a removal ---------------------------------------------
const ASSERTION_FORMS = [
  'h.ok(1, "m")', 'h.eq(1, 1, "m")', 'h.throws(() => 1)', 'ok(1, "m")', 'eq(1, 1, "m")', 'equal(1, 1, "m")',
  'check("n", true)', 'assert(1, "m")', 'assert.ok(1)', 'assert.strict.equal(1, 1)', 'nodeAssert.rejects(f)',
  'nodeAssert.deepStrictEqual(1, 1)', 'assertHasKind(r, "k")', 'expectRefusal(r)', 'h?.ok(1)',
];
for (const form of ASSERTION_FORMS) {
  await test(`vocabulary: dropping \`${form}\` is a removal`, async () => {
    const withIt = `test('t', () => {\n  ${form};\n  ok(2, 'keeper');\n});\n`;
    const { dir, base } = fixture({ 'src/x/test/v.suite.ts': withIt });
    write(dir, 'src/x/test/v.suite.ts', withIt.replace(`  ${form};\n`, ''));
    commit(dir, 'drop it');
    const r = ratchet(dir, { base });
    assert.equal(r.code, 1, `${form}: ${r.out}`);
    assert.match(r.out, /assertions 2 -> 1/);
  });
}

for (const form of ["h.test('t', () => {})", "it('t', () => {})", "import { run } from './x.suite'"]) {
  await test(`vocabulary: dropping \`${form}\` drops the test count`, async () => {
    const withIt = `ok(1, 'keeper');\n${form};\n`;
    const { dir, base } = fixture({ 'src/x/test/v.suite.ts': withIt });
    write(dir, 'src/x/test/v.suite.ts', "ok(1, 'keeper');\n");
    commit(dir, 'drop it');
    const r = ratchet(dir, { base });
    assert.equal(r.code, 1, `${form}: ${r.out}`);
    assert.match(r.out, /tests 1 -> 0/);
  });
}

await test('.tsx and .mjs files are counted, wrapped and non-null callees included', async () => {
  const body = "test('t', () => {\n  (h.ok)(1);\n  h!.eq(1, 1);\n  ok(2);\n});\n";
  for (const file of ['src/x/test/a.suite.tsx', 'scripts/test/b.test.mjs']) {
    const { dir, base } = fixture({ [file]: body });
    write(dir, file, body.replace('  ok(2);\n', ''));
    commit(dir, 'drop');
    const r = ratchet(dir, { base });
    assert.equal(r.code, 1, `${file}: ${r.out}`);
    assert.match(r.out, /assertions 3 -> 2/);
  }
});

await test('removing a suite from its sequencer fails, though the suite file is untouched', async () => {
  const files = {
    'server/test/acceptance.ts': "import { runA } from './a.suite';\nimport { runB } from './b.suite';\nrunA();\nrunB();\n",
    'server/test/a.suite.ts': 'ok(1);\n',
    'server/test/b.suite.ts': 'ok(1);\n',
  };
  const { dir, base } = fixture(files);
  write(dir, 'server/test/acceptance.ts', "import { runA } from './a.suite';\nrunA();\n");
  commit(dir, 'unwire b');
  const r = ratchet(dir, { base });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /server\/test\/acceptance\.ts: assertions 0 -> 0, tests 2 -> 1/);
});

// ---- moving a suite out of reach ------------------------------------------------------------------
await test('a rename out of test/, or to a name no runner discovers, is a removal', async () => {
  for (const to of ['src/a.suite.ts', 'checks/test/a.suite.ts.bak', 'checks/test/a.ts']) {
    const { dir, base } = fixture(BASE_FILES);
    fs.mkdirSync(path.dirname(path.join(dir, to)), { recursive: true });
    git(dir, ['mv', SUITE, to]);
    commit(dir, 'move it');
    const r = ratchet(dir, { base });
    assert.equal(r.code, 1, `${to}: ${r.out}`);
    assert.match(r.out, /moved to/);
  }
});

await test('a detector renamed out of checks/ is a removal', async () => {
  const { dir, base } = fixture({ ...BASE_FILES, 'checks/passes/a.ts': 'export const a = 1;\n' });
  git(dir, ['mv', 'checks/passes/a.ts', 'src/a.ts']);
  commit(dir, 'move detector');
  assert.equal(ratchet(dir, { base }).code, 1);
});

await test('deleting a helper that holds no assertion or test is free', async () => {
  const { dir, base } = fixture({ ...BASE_FILES, 'checks/test/helper.ts': 'export const h = 1;\n' });
  fs.rmSync(path.join(dir, 'checks/test/helper.ts'));
  commit(dir, 'drop helper');
  assert.equal(ratchet(dir, { base }).code, 0);
});

await test('a rename carries its trailer: it is found through the new path too', async () => {
  const { dir, base } = fixture(BASE_FILES);
  git(dir, ['mv', SUITE, 'checks/test/renamed.suite.ts']);
  write(dir, 'checks/test/renamed.suite.ts', SUITE_TEXT.replace("  nodeAssert.ok(true, 'second assertion');\n", ''));
  commit(dir, 'rename and trim\n\nCheck-removal: one assertion was redundant');
  const r = ratchet(dir, { base });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /authorised: checks\/test\/renamed\.suite\.ts: assertions 3 -> 2/);
});

// ---- history shapes and the working tree ----------------------------------------------------------
await test('a trailer on a side branch that was merged in still authorises the removal', async () => {
  const { dir, base } = fixture(BASE_FILES);
  git(dir, ['switch', '-q', '-c', 'side']);
  fs.rmSync(path.join(dir, SUITE));
  commit(dir, 'drop it\n\nCheck-removal: obsolete');
  git(dir, ['switch', '-q', 'main']);
  write(dir, 'docs/other.md', 'x\n');
  commit(dir, 'main moves on');
  git(dir, ['merge', '-q', '--no-ff', 'side', '-m', 'merge side']);
  const r = ratchet(dir, { base });
  assert.equal(r.code, 0, r.out);
});

await test('a trailer on the side of a merge that main also removed (same result on both sides) is still found', async () => {
  const { dir, base } = fixture(BASE_FILES);
  git(dir, ['switch', '-q', '-c', 'side']);
  fs.rmSync(path.join(dir, SUITE));
  commit(dir, 'side drops it\n\nCheck-removal: obsolete');
  git(dir, ['switch', '-q', 'main']);
  fs.rmSync(path.join(dir, SUITE));
  commit(dir, 'main drops it too');
  git(dir, ['merge', '-q', '--no-ff', 'side', '-m', 'merge side']);
  const r = ratchet(dir, { base });
  assert.equal(r.code, 0, r.out);
});

await test('a trailer on the old path still covers the file after a later pure rename', async () => {
  const { dir, base } = fixture(BASE_FILES);
  write(dir, SUITE, SUITE_TEXT.replace("  nodeAssert.ok(true, 'second assertion');\n", ''));
  commit(dir, 'trim\n\nCheck-removal: one assertion was redundant');
  git(dir, ['mv', SUITE, 'checks/test/renamed.suite.ts']);
  commit(dir, 'rename');
  const r = ratchet(dir, { base });
  assert.equal(r.code, 0, r.out);
});

await test('an uncommitted drop in a file that still exists fails and names the file', async () => {
  const { dir, base } = fixture(BASE_FILES);
  write(dir, SUITE, SUITE_TEXT.replace("  nodeAssert.ok(true, 'second assertion');\n", ''));
  const r = ratchet(dir, { base });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /sample\.suite\.ts: assertions 3 -> 2/);
  assert.match(r.out, /uncommitted changes/);
});

await test('--head compares that commit, ignoring the working tree', async () => {
  const { dir, base } = fixture(BASE_FILES);
  write(dir, 'docs/n.md', 'n\n');
  const tip = commit(dir, 'unrelated change');
  fs.rmSync(path.join(dir, SUITE)); // uncommitted deletion must not count
  assert.equal(ratchet(dir, { base, args: ['--head', tip] }).code, 0);
});

await test('GATE_BASE wins over the merge-base with main', async () => {
  const { dir } = fixture(BASE_FILES);
  git(dir, ['switch', '-q', '-c', 'work']);
  fs.rmSync(path.join(dir, SUITE));
  const mid = commit(dir, 'delete on a branch');
  write(dir, 'docs/n.md', 'n\n');
  commit(dir, 'later');
  // Pinned after the deletion, nothing was lost since; unpinned, the merge-base still sees it.
  assert.equal(ratchet(dir, { base: mid }).code, 0);
  assert.equal(ratchet(dir).code, 1);
});

await test('node_modules and invariants/ are not verification code', async () => {
  const { dir, base } = fixture({
    ...BASE_FILES,
    'invariants/test/i.suite.ts': 'ok(1);\n',
    'node_modules/pkg/test/n.suite.ts': 'ok(1);\n',
  });
  fs.rmSync(path.join(dir, 'invariants'), { recursive: true });
  git(dir, ['rm', '-rq', '--cached', 'node_modules']);
  commit(dir, 'drop them');
  assert.equal(ratchet(dir, { base }).code, 0);
});

// ---- more shell ------------------------------------------------------------------------------------
await test('shell: the helper words and a dispatch call each count', async () => {
  const forms = ['expect_value a b', 'ok "x"', 'pass "x"', 'fail "x"', 'case_two', 'VAR=1 assert_x a', 'true && assert_y b'];
  for (const form of forms) {
    const text = `#!/usr/bin/env bash\n${form}\nok "keeper"\n`;
    const { dir, base } = fixture({ 'scripts/test/s.test.sh': text });
    write(dir, 'scripts/test/s.test.sh', '#!/usr/bin/env bash\nok "keeper"\n');
    commit(dir, 'drop');
    const r = ratchet(dir, { base });
    assert.equal(r.code, 1, `${form}: ${r.out}`);
  }
});

await test('shell: a delimiter with a dash, and an arithmetic shift, do not swallow the assertions after them', async () => {
  const text = "#!/usr/bin/env bash\ncat <<END-OF\nbody\nEND-OF\nx=$(( 1 << 3 ))\nok \"a\"\nok \"b\"\n";
  const { dir, base } = fixture({ 'scripts/test/s.test.sh': text });
  write(dir, 'scripts/test/s.test.sh', text.replace('ok "b"\n', ''));
  commit(dir, 'drop b');
  const r = ratchet(dir, { base });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /assertions 2 -> 1/);
});

// ---- the epoch: history from before the ratchet existed is not held to it -------------------------
const OLD = 'checks/test/old.suite.ts';
const NEW = 'checks/test/new.suite.ts';
const ENGINE = 'scripts/removal-ratchet.mjs';

// c0 holds two suites; c1 deletes OLD (before the ratchet exists); c2 adds the ratchet script (the
// epoch); c3 is an unrelated commit; NEW is deleted by the test, after the epoch.
function epochFixture() {
  const { dir, base: c0 } = fixture({ [OLD]: SUITE_TEXT, [NEW]: SUITE_TEXT });
  fs.rmSync(path.join(dir, OLD));
  const c1 = commit(dir, 'pre-epoch removal');
  write(dir, ENGINE, '// the ratchet lands here\n');
  const epoch = commit(dir, 'add the ratchet');
  write(dir, 'docs/n.md', 'n\n');
  const c3 = commit(dir, 'unrelated');
  return { dir, c0, c1, epoch, c3 };
}

await test('epoch: a base older than the epoch passes a pre-epoch removal, and says it clamped', async () => {
  const f = epochFixture();
  const r = ratchet(f.dir, { base: f.c0 });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, new RegExp(`base ${f.c0.slice(0, 8)} predates the ratchet \\(added in ${f.epoch.slice(0, 8)}\\); comparing from ${f.epoch.slice(0, 8)}`));
});

await test('epoch: a post-epoch removal without a trailer still fails when the base is older', async () => {
  const f = epochFixture();
  fs.rmSync(path.join(f.dir, NEW));
  commit(f.dir, 'post-epoch removal');
  const r = ratchet(f.dir, { base: f.c0 });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /new\.suite\.ts: deleted/);
  assert.doesNotMatch(r.out, /old\.suite\.ts/);
});

await test('epoch: a post-epoch removal with a trailer passes when the base is older', async () => {
  const f = epochFixture();
  fs.rmSync(path.join(f.dir, NEW));
  commit(f.dir, 'post-epoch removal\n\nCheck-removal: the screen is gone');
  const r = ratchet(f.dir, { base: f.c0 });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /authorised: checks\/test\/new\.suite\.ts: deleted/);
});

await test('epoch: an older base clamps the same way unpinned (merge-base with main) and with --head', async () => {
  const f = epochFixture();
  git(f.dir, ['switch', '-q', '-c', 'work', f.c0]);
  git(f.dir, ['merge', '-q', '--ff-only', 'main']);
  git(f.dir, ['branch', '-f', 'main', f.c0]); // main is where the branch started: older than the epoch
  fs.rmSync(path.join(f.dir, NEW));
  commit(f.dir, 'post-epoch removal');
  const unpinned = ratchet(f.dir);
  assert.equal(unpinned.code, 1, unpinned.out);
  assert.match(unpinned.out, /predates the ratchet/);
  assert.doesNotMatch(unpinned.out, /old\.suite\.ts/);
  const head = ratchet(f.dir, { base: f.c0, args: ['--head', f.c3] });
  assert.equal(head.code, 0, head.out);
});

await test('epoch: a base after the epoch is used unchanged, with no clamp line', async () => {
  const f = epochFixture();
  fs.rmSync(path.join(f.dir, NEW));
  commit(f.dir, 'post-epoch removal');
  const after = ratchet(f.dir, { base: f.c3 });
  assert.equal(after.code, 1, after.out);
  assert.doesNotMatch(after.out, /predates the ratchet/);
  const atEpoch = ratchet(f.dir, { base: f.epoch });
  assert.equal(atEpoch.code, 1, atEpoch.out);
  assert.doesNotMatch(atEpoch.out, /predates the ratchet/);
});

await test('epoch: with no commit that added the script there is no clamp', async () => {
  const { dir, base } = fixture(BASE_FILES);
  fs.rmSync(path.join(dir, SUITE));
  commit(dir, 'delete');
  const absent = ratchet(dir, { base });
  assert.equal(absent.code, 1, absent.out);
  assert.doesNotMatch(absent.out, /predates the ratchet/);
  write(dir, ENGINE, '// uncommitted\n'); // present in the working tree only
  const uncommitted = ratchet(dir, { base });
  assert.equal(uncommitted.code, 1, uncommitted.out);
  assert.doesNotMatch(uncommitted.out, /predates the ratchet/);
});

// ---- the base -------------------------------------------------------------------------------------
await test('without GATE_BASE the base is the merge-base with main', async () => {
  const { dir } = fixture(BASE_FILES);
  git(dir, ['switch', '-q', '-c', 'work']);
  fs.rmSync(path.join(dir, SUITE));
  commit(dir, 'delete on a branch');
  const r = ratchet(dir);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /merge-base with main/);
});

await test('an unresolvable GATE_BASE refuses with exit 2', async () => {
  const { dir } = fixture(BASE_FILES);
  const r = ratchet(dir, { base: 'deadbeef00000000000000000000000000000000' });
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /not a commit/);
});

console.log(`\n${pass} passed`);
