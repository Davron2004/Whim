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

const TMPS = [];
function fixture(files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), PREFIX)));
  TMPS.push(dir);
  git(dir, ['init', '-q', '-b', 'main']);
  for (const [f, text] of Object.entries(files)) write(dir, f, text);
  const base = commit(dir, 'base');
  return { dir, base };
}

function ratchet(repo, { base, env = {}, args = [] } = {}) {
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
`; // 2 assertions (+ pass/fail inside helpers: 1 + 1 + 1 ... see below), 1 test

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
  assert.match(r.out, /tests 1 -> 0/);
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

for (const dir of TMPS) {
  if (path.dirname(dir) === fs.realpathSync(os.tmpdir()) && path.basename(dir).startsWith(PREFIX)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
console.log(`\n${pass} passed`);
