#!/usr/bin/env node
// Removal ratchet for verification code (GitHub #159, docs/harness.md section 4.3).
//
// Agents may add checks and assertions freely. Removing or loosening one must be visible and
// deliberate: this script compares the verification code of a base commit with the tree being
// gated and fails when a verification file was deleted, or when a file's count of assertions or of
// test declarations dropped, unless a commit in BASE..HEAD that touches the file carries a
// `Check-removal: <reason>` trailer.
//
//   node scripts/removal-ratchet.mjs [--base <rev>] [--head <rev>] [--quiet]
//
//   base  --base, else $GATE_BASE (the pinned commit the gate's tamper tripwire uses), else the
//         merge-base of HEAD with main.
//   head  the working tree by default. `--head <rev>` compares that commit instead (calibration
//         over history, and the tests). With the working tree, a removal in a file that has
//         uncommitted changes can never be authorised: the trailer lives on a commit.
//
// EPOCH. The ratchet does not apply to history from before it existed: the epoch is the oldest
// commit, reachable from the tree being gated, that added scripts/removal-ratchet.mjs. A base that
// is a strict ancestor of the epoch is replaced by the epoch (however the base was chosen), and one
// line says so. A base at or after the epoch is used as given. With no such commit (the script is
// uncommitted, or absent from the history) there is no clamp.
//
// Exit 0 = pass, 1 = a removal without authorisation, 2 = the base could not be resolved.
//
// WHAT IS COUNTED (one table, below). Per file, two numbers: assertion call sites and test
// declarations, found by parsing (TypeScript's parser for .ts/.tsx/.mjs, a small scanner for .sh),
// so comments and string literals never count: commenting an assertion out is a removal, and
// rewording one that keeps the same call is not. Counts, not line diffs.
// NOT COVERED: a case removed from a data table that one loop asserts over, a weakened
// expectation (`h.eq(x, 1)` -> `h.eq(x, x)`), unreachable code around an assertion, an assertion
// moved to another file (count it in the new file and authorise the old), a `testXxx()` call
// dropped from checks/test/acceptance.ts or a `case_*` function left out of a shell dispatch list,
// the detectors under checks/ outside test dirs (deletion only), fixtures/ (inputs, not checks),
// and invariants/ (owner-authored, under the gate's CONFIG_SET tripwire instead).
// A refactor that merges assertions or turns tests into a loop reads as a removal: say so in the
// trailer.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// ---- the vocabulary: every counting rule lives in this table ------------------------------------
const VOCABULARY = {
  // JavaScript / TypeScript: a call whose callee text matches counts.
  js: {
    // `ok(cond, msg)`, `eq(a, b, msg)`, `check(name, cond)`, `assert(cond, msg)` are the per-suite or
    // harness helpers (checks/test/harness.ts, evals|server/test/harness.ts, the bridge, storage and
    // version-store acceptance files, the sdk suites); `h.*` is the server suites' harness handle.
    assertionCallees: new Set(['assert', 'ok', 'eq', 'equal', 'check', 'h.ok', 'h.eq', 'h.throws']),
    // node:assert, imported as `assert` or `nodeAssert`.
    nodeAssertReceivers: new Set(['assert', 'nodeAssert']),
    nodeAssertMethods: new Set([
      'ok', 'equal', 'notEqual', 'strictEqual', 'notStrictEqual', 'deepEqual', 'notDeepEqual',
      'deepStrictEqual', 'notDeepStrictEqual', 'match', 'doesNotMatch', 'throws', 'doesNotThrow',
      'rejects', 'doesNotReject', 'ifError',
    ]),
    // The repo's own assertion-helper naming: assertHasKind, assertNoGitLeak, expectRefusal, ...
    assertionFamilies: [/^assert[A-Z]\w*$/, /^expect[A-Z]\w*$/],
    // Test declarations: `test(name, fn)` and the server suites' `h.test(name, fn)`.
    testCallees: new Set(['test', 'h.test', 'it']),
    // A sequencer registers a suite by importing its module (server|launcher|checks/test/acceptance.ts),
    // so each import of a `*.suite` module counts as a test declaration: dropping one stops the suite.
    suiteImport: /\.suite$/,
  },
  // Shell tests: a command word at command position (function definitions excluded).
  sh: {
    assertionWords: [/^assert_\w+$/, /^expect_\w+$/, /^ok$/, /^pass$/, /^fail$/],
    // A `case_x() {` definition and each `case_x` call both count (the call is the dispatch).
    testFunctions: /^(?:case|test)_\w+$/,
  },
};

// ---- what is verification code -------------------------------------------------------------------
const CODE = /\.(?:tsx?|mjs|cjs|js|sh)$/;
// Verification code: checks/** and every test directory's code. Fixtures are inputs, not checks;
// invariants/ is owner-authored and under the gate's CONFIG_SET.
function classify(file) {
  if (!CODE.test(file)) return null;
  if (file.startsWith('invariants/') || file.includes('node_modules/')) return null;
  if (/(^|\/)fixtures\//.test(file)) return null;
  if (/(^|\/)test\//.test(file)) return 'counted'; // suites, harnesses, runners (counts may be 0)
  if (file.startsWith('checks/')) return 'deletion-only'; // the static-check detectors
  return null;
}

// Runners find suites by file name (`*.acceptance.ts`, `*.test.ts`, imports of `*.suite`), so a
// rename that drops the marker silently stops the suite even though the content is unchanged.
function discoverable(file) {
  return /\.(?:suite|acceptance|test)\.[a-z]+$/.test(file);
}

// ---- counting: JavaScript and TypeScript ---------------------------------------------------------
function calleeText(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) {
    const left = calleeText(node.expression);
    return left === null ? null : `${left}.${node.name.text}`;
  }
  if (ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node)) return calleeText(node.expression);
  return null;
}

function isAssertionCallee(name) {
  const v = VOCABULARY.js;
  if (v.assertionCallees.has(name)) return true;
  const normal = name.replace(/^(assert|nodeAssert)\.strict\./, '$1.');
  const dot = normal.indexOf('.');
  if (dot < 0) return v.assertionFamilies.some((re) => re.test(name));
  return v.nodeAssertReceivers.has(normal.slice(0, dot)) && v.nodeAssertMethods.has(normal.slice(dot + 1));
}

function scriptKind(file) {
  if (file.endsWith('x')) return ts.ScriptKind.TSX;
  return file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
}

function countJs(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, scriptKind(file));
  const counts = { assertions: 0, tests: 0 };
  const walk = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && VOCABULARY.js.suiteImport.test(node.moduleSpecifier.text)) {
      counts.tests += 1;
    }
    if (ts.isCallExpression(node)) {
      const name = calleeText(node.expression);
      if (name !== null && VOCABULARY.js.testCallees.has(name)) counts.tests += 1;
      else if (name !== null && isAssertionCallee(name)) counts.assertions += 1;
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return counts;
}

// ---- counting: shell ------------------------------------------------------------------------------
// Blank comments, quoted strings and heredoc bodies out of a shell script, keeping newlines.
function stripShell(src) {
  const st = { out: '', i: 0, heredocs: [] };
  while (st.i < src.length) shellStep(src, st);
  return st.out;
}

function startsComment(src, i) {
  return i === 0 || /[\s;&|(]/.test(src[i - 1]);
}

function shellStep(src, st) {
  const c = src[st.i];
  if (c === '\n') return shellNewline(src, st);
  if (c === "'" || c === '"') return shellQuoted(src, st, c);
  if (c === '#' && startsComment(src, st.i)) return shellComment(src, st);
  if (c === '\\') {
    st.out += ' ';
    st.i += 2;
    return undefined;
  }
  const heredoc = c === '<' ? heredocStart(src, st.i) : null;
  if (heredoc) {
    st.heredocs.push(heredoc);
    st.out += '  ';
    st.i += 2;
    return undefined;
  }
  st.out += c;
  st.i += 1;
  return undefined;
}

// `<<WORD`, `<<-WORD`, `<<'WORD'`, `<<"WORD"` at i, but not the here-string `<<<`.
function heredocStart(src, i) {
  if (src[i + 1] !== '<' || src[i + 2] === '<' || src[i - 1] === '<') return null;
  const before = src.slice(src.lastIndexOf('\n', i) + 1, i);
  if (before.lastIndexOf('((') > before.lastIndexOf('))')) return null; // `$(( 1 << k ))` is a shift
  const m = /^<<(-?)[ \t]*(?:'([^']+)'|"([^"]+)"|\\?([^\s;&|<>()]+))/.exec(src.slice(i, i + 200));
  return m ? { delim: m[2] ?? m[3] ?? m[4], dash: m[1] === '-' } : null;
}

function shellComment(src, st) {
  while (st.i < src.length && src[st.i] !== '\n') st.i += 1;
}

function shellQuoted(src, st, quote) {
  let j = st.i + 1;
  while (j < src.length && src[j] !== quote) j += quote === '"' && src[j] === '\\' ? 2 : 1;
  const stop = Math.min(j + 1, src.length);
  st.out += '""' + src.slice(st.i, stop).replaceAll(/[^\n]/g, '');
  st.i = stop;
}

function shellNewline(src, st) {
  st.out += '\n';
  st.i += 1;
  for (const { delim, dash } of st.heredocs.splice(0)) {
    while (st.i < src.length) {
      let end = src.indexOf('\n', st.i);
      if (end === -1) end = src.length;
      const line = src.slice(st.i, end);
      st.i = Math.min(end + 1, src.length);
      st.out += '\n';
      if ((dash ? line.replace(/^\t+/, '') : line) === delim) break;
    }
  }
}

// First word of a command piece, after any `VAR=value` prefixes.
function commandWord(piece) {
  let rest = piece.trimStart();
  for (;;) {
    const assignment = /^\w+=\S*/.exec(rest);
    if (assignment === null) break;
    rest = rest.slice(assignment[0].length).trimStart();
  }
  return /^(\w+)(?![\w=])/.exec(rest)?.[1];
}

function countSh(text) {
  const clean = stripShell(text);
  let tests = 0;
  for (const m of clean.matchAll(/^[ \t]*(?:function[ \t]+)?(\w+)[ \t]*\(\)/gm)) {
    if (VOCABULARY.sh.testFunctions.test(m[1])) tests += 1;
  }
  // Command position: split on the things that start a command, then read each piece's first word.
  const pieces = clean
    .replaceAll(/^[ \t]*(?:function[ \t]+)?\w+[ \t]*\(\)/gm, ' ') // function definitions are not calls
    .replaceAll(/&&|\|\||\$\(|[;|&(){`]|!(?=[ \t])/g, '\n')
    .replaceAll(/\b(?:then|do|else|elif|if|while|until)\b/g, '\n')
    .split('\n');
  let assertions = 0;
  for (const piece of pieces) {
    const word = commandWord(piece);
    if (word === undefined) continue;
    if (VOCABULARY.sh.testFunctions.test(word)) tests += 1;
    else if (VOCABULARY.sh.assertionWords.some((re) => re.test(word))) assertions += 1;
  }
  return { assertions, tests };
}

function countFile(file, text) {
  return file.endsWith('.sh') ? countSh(text) : countJs(file, text);
}

// ---- git -----------------------------------------------------------------------------------------
function git(args, { allowFail = false } = {}) {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- intentional: the gate runs inside the repo's own dev/CI toolchain, which always has a trustworthy `git` on PATH
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0 && !allowFail) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`);
  }
  return r.status === 0 ? r.stdout : null;
}

function resolveBase(explicit) {
  let label;
  let rev;
  if (explicit) {
    [label, rev] = ['--base', explicit];
  } else if (process.env.GATE_BASE) {
    [label, rev] = ['GATE_BASE', process.env.GATE_BASE];
  } else {
    const main = ['main', 'origin/main'].find((m) => git(['rev-parse', '--verify', '--quiet', m], { allowFail: true }));
    if (main === undefined) return { error: 'no base: GATE_BASE is unset and there is no main or origin/main to take a merge-base with' };
    label = `merge-base with ${main}`;
    rev = git(['merge-base', 'HEAD', main]).trim();
  }
  const sha = git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { allowFail: true });
  return sha ? { sha: sha.trim(), label } : { error: `base ${rev} (${label}) is not a commit in this repository` };
}

// The commit that first added this script, reachable from `head` (default HEAD), or null.
function findEpoch(head) {
  const out = git(['log', '--diff-filter=A', '--format=%H', head ?? 'HEAD', '--', 'scripts/removal-ratchet.mjs'], { allowFail: true });
  const hits = (out ?? '').split('\n').filter(Boolean);
  return hits.length > 0 ? hits[hits.length - 1] : null;
}

// Replace a base that predates the ratchet with the commit that introduced it.
function clampToEpoch(base, head) {
  const epoch = findEpoch(head);
  if (epoch === null || epoch === base.sha) return base;
  if (git(['merge-base', '--is-ancestor', base.sha, epoch], { allowFail: true }) === null) return base;
  console.log(`removal ratchet: base ${base.sha.slice(0, 8)} predates the ratchet (added in ${epoch.slice(0, 8)}); comparing from ${epoch.slice(0, 8)}`);
  return { sha: epoch, label: `${base.label}, clamped to the commit that added the ratchet` };
}

// Changed files between base and the tree being gated, renames paired: [{ status, oldPath, newPath }].
function changedFiles(base, head) {
  const args = ['diff', '--name-status', '-M', '-l20000', '-z', base];
  if (head) args.push(head);
  const parts = git(args).split('\0');
  const rows = [];
  let i = 0;
  while (i < parts.length && parts[i] !== '') {
    const paired = parts[i][0] === 'R' || parts[i][0] === 'C';
    rows.push({ status: parts[i][0], oldPath: parts[i + 1], newPath: parts[paired ? i + 2 : i + 1] });
    i += paired ? 3 : 2;
  }
  return rows;
}

// Check-removal trailers on commits in base..head that touch `paths`: [{ sha, reason }], where an
// empty reason is ''. Git parses the trailer block, so prose elsewhere in a message never counts.
function removalTrailers(base, head, paths) {
  const out = git([
    'log', '--no-merges', '--full-history', '-z',
    '--format=%H%x1f%(trailers:key=Check-removal,unfold)',
    `${base}..${head ?? 'HEAD'}`, '--', ...paths,
  ]);
  const found = [];
  for (const rec of out.split('\0')) {
    const [sha, block] = rec.replace(/^\n/, '').split('\x1f');
    if (!sha || block === undefined) continue;
    for (const m of block.matchAll(/^Check-removal:(.*)$/gim)) found.push({ sha, reason: m[1].trim() });
  }
  return found;
}

// ---- comparing -----------------------------------------------------------------------------------
function currentText(top, head, file) {
  if (head) return git(['show', `${head}:${file}`], { allowFail: true });
  const abs = path.join(top, file);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
}

// One changed file -> a removal record, or null when nothing was lost.
function removalFor(row, base, top, head) {
  const kind = classify(row.oldPath);
  if (kind === null || row.status === 'A' || row.status === 'C') return null;
  const before = git(['show', `${base}:${row.oldPath}`], { allowFail: true });
  if (before === null) return null;
  const beforeCounts = kind === 'counted' ? countFile(row.oldPath, before) : null;
  // A helper under test/ with no assertion and no test (a fixture builder, a shim) holds no check.
  if (beforeCounts && beforeCounts.assertions + beforeCounts.tests === 0) return null;
  const moved = row.oldPath !== row.newPath;
  const paths = moved ? [row.oldPath, row.newPath] : [row.oldPath];
  const now = row.status === 'D' ? null : currentText(top, head, row.newPath);
  if (now === null) return { file: row.oldPath, paths, deleted: true, before: beforeCounts };
  // Moved out of verification code, or renamed so no runner finds it: the checks are gone.
  if (moved && (classify(row.newPath) !== kind || (kind === 'counted' && discoverable(row.oldPath) && !discoverable(row.newPath)))) {
    return { file: row.oldPath, paths, deleted: true, movedTo: row.newPath, before: beforeCounts };
  }
  if (kind !== 'counted') return null;
  const after = countFile(row.oldPath, now);
  if (after.assertions >= beforeCounts.assertions && after.tests >= beforeCounts.tests) return null;
  return { file: row.newPath, paths, deleted: false, before: beforeCounts, after };
}

function dirtyPaths() {
  const records = git(['status', '--porcelain', '-z']).split('\0');
  const dirty = new Set();
  for (let i = 0; i < records.length; i += 1) {
    if (records[i].length <= 3) continue;
    dirty.add(records[i].slice(3));
    if (/[RC]/.test(records[i].slice(0, 2))) {
      i += 1; // a rename or copy is followed by a bare record holding its source path
      if (records[i]) dirty.add(records[i]);
    }
  }
  return dirty;
}

function whyRejected(uncommitted, trailers) {
  if (uncommitted) return 'uncommitted';
  return trailers.length > 0 ? 'empty-reason' : 'no-trailer';
}

// Split removals into those a Check-removal trailer covers and those it does not.
function authorise(removals, base, head) {
  const dirty = head || removals.length === 0 ? new Set() : dirtyPaths();
  const accepted = [];
  const rejected = [];
  for (const r of removals) {
    const uncommitted = r.paths.some((p) => dirty.has(p));
    const trailers = uncommitted ? [] : removalTrailers(base, head, r.paths);
    const good = trailers.find((t) => t.reason);
    if (good) accepted.push({ ...r, sha: good.sha, reason: good.reason });
    else rejected.push({ ...r, why: whyRejected(uncommitted, trailers) });
  }
  return { accepted, rejected };
}

// ---- output --------------------------------------------------------------------------------------
const WHY = {
  'no-trailer': 'no commit in the branch that touches this file carries a "Check-removal: <reason>" trailer',
  'empty-reason': 'a Check-removal trailer is present but its reason is empty; say why the check is going',
  uncommitted: 'the file has uncommitted changes; commit it with a "Check-removal: <reason>" trailer, then re-run',
};

function describe(r) {
  if (r.deleted) {
    const was = r.before ? ` (was ${r.before.assertions} assertions, ${r.before.tests} tests)` : '';
    if (r.movedTo) return `${r.file}: moved to ${r.movedTo}, which no runner or check scan reads as verification code${was}`;
    return `${r.file}: deleted${was}`;
  }
  return `${r.file}: assertions ${r.before.assertions} -> ${r.after.assertions}, tests ${r.before.tests} -> ${r.after.tests}`;
}

function printFailure(rejected) {
  console.error('removal ratchet: FAIL -- verification code lost checks without a Check-removal trailer:');
  for (const r of rejected) {
    console.error(`  ${describe(r)}`);
    console.error(`      ${WHY[r.why]}`);
  }
  console.error('');
  console.error('Adding checks needs nothing. To remove or loosen one on purpose, commit the change with a trailer');
  console.error('on a commit that touches the file (last paragraph of the message, after a blank line):');
  console.error('');
  console.error('    Check-removal: <why this check is no longer needed>');
  console.error('');
  console.error('The orchestrator lists these trailers at merge and accepts or rejects each. Otherwise restore the check.');
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base') opts.base = argv[++i];
    else if (argv[i] === '--head') opts.head = argv[++i];
    else if (argv[i] === '--quiet') opts.quiet = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return opts;
}

function run() {
  const opts = parseArgs(process.argv.slice(2));
  const top = git(['rev-parse', '--show-toplevel']).trim();
  process.chdir(top);
  const resolved = resolveBase(opts.base);
  if (resolved.error) {
    console.error(`removal ratchet: ${resolved.error}`);
    console.error('Set GATE_BASE to the pinned base commit, or make `main` resolvable.');
    return 2;
  }
  const base = clampToEpoch(resolved, opts.head);

  const rows = changedFiles(base.sha, opts.head);
  const removals = rows.map((row) => removalFor(row, base.sha, top, opts.head)).filter((r) => r !== null);
  const { accepted, rejected } = authorise(removals, base.sha, opts.head);

  if (!opts.quiet || rejected.length > 0) {
    const compared = rows.filter((r) => classify(r.oldPath) !== null).length;
    console.log(`removal ratchet: base ${base.sha.slice(0, 8)} (${base.label}); ${compared} changed verification file(s) compared`);
  }
  for (const a of accepted) {
    console.log(`  authorised: ${describe(a)} -- ${a.sha.slice(0, 8)} Check-removal: ${a.reason}`);
  }
  if (rejected.length === 0) {
    console.log('removal ratchet: PASS');
    return 0;
  }
  printFailure(rejected);
  return 1;
}

try {
  process.exitCode = run();
} catch (err) {
  console.error(`removal ratchet: could not compare (${err instanceof Error ? err.message : String(err)})`);
  process.exitCode = 2;
}
