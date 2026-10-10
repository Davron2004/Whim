#!/usr/bin/env node
// Removal ratchet for verification code (GitHub #159, docs/harness.md "Removal ratchet").
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
// Exit 0 = pass, 1 = a removal without authorisation, 2 = the base could not be resolved.
//
// WHAT IS COUNTED (one table, below). Per file, two numbers: assertion call sites and test
// declarations, found by parsing (TypeScript's parser for .ts/.tsx/.mjs, a small scanner for .sh),
// so comments and string literals never count: commenting an assertion out is a removal, and
// rewording one that keeps the same call is not. Counts, not line diffs.
// NOT COVERED: a case removed from a data table that one loop asserts over, a weakened
// expectation (`h.eq(x, 1)` -> `h.eq(x, x)`), a moved assertion (count it in the new file and
// authorise the old), the detectors under checks/ outside test dirs (deletion only), and
// invariants/ (owner-authored, under the gate's CONFIG_SET tripwire instead).
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
  },
  // Shell tests: a command word at command position (function definitions excluded).
  sh: {
    assertionWords: [/^assert_\w+$/, /^expect_\w+$/, /^ok$/, /^pass$/, /^fail$/],
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
  const inTestDir = /(^|\/)test\//.test(file);
  if (inTestDir) return 'counted'; // **/test/** suites, harnesses, runners (counts may be 0)
  if (file.startsWith('checks/')) return 'deletion-only'; // the static-check detectors
  return null;
}

// ---- counting ------------------------------------------------------------------------------------
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
  const dot = name.indexOf('.');
  if (dot > 0 && v.nodeAssertReceivers.has(name.slice(0, dot)) && v.nodeAssertMethods.has(name.slice(dot + 1))) return true;
  return dot < 0 && v.assertionFamilies.some((re) => re.test(name));
}

function countJs(file, text) {
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind);
  let assertions = 0;
  let tests = 0;
  const walk = (node) => {
    if (ts.isCallExpression(node)) {
      const name = calleeText(node.expression);
      if (name !== null) {
        if (VOCABULARY.js.testCallees.has(name)) tests += 1;
        else if (isAssertionCallee(name)) assertions += 1;
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return { assertions, tests };
}

// Blank comments, quoted strings and heredoc bodies out of a shell script, keeping newlines.
function stripShell(src) {
  let out = '';
  let i = 0;
  const heredocs = [];
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '\n') {
      out += '\n';
      i += 1;
      while (heredocs.length > 0) {
        const { delim, dash } = heredocs.shift();
        for (;;) {
          if (i >= n) break;
          let end = src.indexOf('\n', i);
          if (end === -1) end = n;
          const line = src.slice(i, end);
          i = Math.min(end + 1, n);
          out += '\n';
          if ((dash ? line.replace(/^\t+/, '') : line) === delim) break;
        }
      }
      continue;
    }
    if (c === '\\') {
      out += ' ';
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      const stop = end === -1 ? n : end + 1;
      out += '""' + src.slice(i, stop).replace(/[^\n]/g, '');
      i = stop;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      const stop = Math.min(j + 1, n);
      out += '""' + src.slice(i, stop).replace(/[^\n]/g, '');
      i = stop;
      continue;
    }
    if (c === '#') {
      const prev = i === 0 ? '\n' : src[i - 1];
      if (/[\s;&|(]/.test(prev)) {
        while (i < n && src[i] !== '\n') i += 1;
        continue;
      }
    }
    if (c === '<' && src[i + 1] === '<' && src[i + 2] !== '<' && src[i - 1] !== '<') {
      const m = /^<<(-?)[ \t]*(?:'([^']+)'|"([^"]+)"|\\?([A-Za-z_][\w]*))/.exec(src.slice(i, i + 200));
      if (m) {
        heredocs.push({ delim: m[2] ?? m[3] ?? m[4], dash: m[1] === '-' });
        out += '  ';
        i += 2;
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return out;
}

const SH_COMMAND_POSITION = /(?:^|[;&|({!]|\$\(|\b(?:then|do|else|elif|if|while|until)\b)[ \t]*([A-Za-z_][\w]*)(?![\w=])(?![ \t]*\(\))/gm;

function countSh(text) {
  const clean = stripShell(text);
  let assertions = 0;
  for (const m of clean.matchAll(SH_COMMAND_POSITION)) {
    if (VOCABULARY.sh.assertionWords.some((re) => re.test(m[1]))) assertions += 1;
  }
  let tests = 0;
  for (const m of clean.matchAll(/^[ \t]*(?:function[ \t]+)?([A-Za-z_]\w*)[ \t]*\(\)/gm)) {
    if (VOCABULARY.sh.testFunctions.test(m[1])) tests += 1;
  }
  return { assertions, tests };
}

function countFile(file, text) {
  return file.endsWith('.sh') ? countSh(text) : countJs(file, text);
}

// ---- git -----------------------------------------------------------------------------------------
function git(args, { allowFail = false } = {}) {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0 && !allowFail) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`);
  }
  return r.status === 0 ? r.stdout : null;
}

function resolveBase(explicit) {
  const candidates = [];
  if (explicit) candidates.push(['--base', explicit]);
  else if (process.env.GATE_BASE) candidates.push(['GATE_BASE', process.env.GATE_BASE]);
  else {
    for (const main of ['main', 'origin/main']) {
      const mb = git(['merge-base', 'HEAD', main], { allowFail: true });
      if (mb) {
        candidates.push([`merge-base with ${main}`, mb.trim()]);
        break;
      }
    }
  }
  if (candidates.length === 0) return { error: 'no base: GATE_BASE is unset and there is no main or origin/main to take a merge-base with' };
  const [label, rev] = candidates[0];
  const sha = git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { allowFail: true });
  if (!sha) return { error: `base ${rev} (${label}) is not a commit in this repository` };
  return { sha: sha.trim(), label };
}

// Changed files between base and the tree being gated, renames paired: [{ status, oldPath, newPath }].
function changedFiles(base, head) {
  const args = ['diff', '--name-status', '-M', '-z', base];
  if (head) args.push(head);
  const parts = git(args).split('\0');
  const rows = [];
  for (let i = 0; i < parts.length && parts[i] !== ''; ) {
    const status = parts[i];
    if (status[0] === 'R' || status[0] === 'C') {
      rows.push({ status: status[0], oldPath: parts[i + 1], newPath: parts[i + 2] });
      i += 3;
    } else {
      rows.push({ status: status[0], oldPath: parts[i + 1], newPath: parts[i + 1] });
      i += 2;
    }
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
    for (const m of block.matchAll(/^Check-removal:[ \t]*(.*)$/gim)) found.push({ sha, reason: m[1].trim() });
  }
  return found;
}

// ---- main ----------------------------------------------------------------------------------------
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

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const top = git(['rev-parse', '--show-toplevel']).trim();
  process.chdir(top);
  const base = resolveBase(opts.base);
  if (base.error) {
    console.error(`removal ratchet: ${base.error}`);
    console.error('Set GATE_BASE to the pinned base commit, or make `main` resolvable.');
    return 2;
  }

  const readCurrent = (file) => {
    if (opts.head) return git(['show', `${opts.head}:${file}`], { allowFail: true });
    try {
      return fs.readFileSync(path.join(top, file), 'utf8');
    } catch {
      return null;
    }
  };

  const removals = [];
  let compared = 0;
  for (const row of changedFiles(base.sha, opts.head)) {
    if (row.status === 'A' || row.status === 'C') continue;
    const kind = classify(row.oldPath);
    if (kind === null) continue;
    compared += 1;
    const before = git(['show', `${base.sha}:${row.oldPath}`], { allowFail: true });
    if (before === null) continue;
    const beforeCounts = kind === 'counted' ? countFile(row.oldPath, before) : null;
    const nowText = row.status === 'D' ? null : readCurrent(row.newPath);
    if (nowText === null) {
      removals.push({ file: row.oldPath, paths: [row.oldPath], deleted: true, before: beforeCounts });
      continue;
    }
    if (kind !== 'counted') continue;
    const after = countFile(row.oldPath, nowText);
    if (after.assertions < beforeCounts.assertions || after.tests < beforeCounts.tests) {
      const paths = row.oldPath === row.newPath ? [row.oldPath] : [row.oldPath, row.newPath];
      removals.push({ file: row.newPath, paths, deleted: false, before: beforeCounts, after });
    }
  }

  const dirty = new Set();
  if (!opts.head && removals.length > 0) {
    const porcelain = git(['status', '--porcelain', '-z', '--untracked-files=all']);
    for (const rec of porcelain.split('\0')) if (rec.length > 3) dirty.add(rec.slice(3));
  }

  const accepted = [];
  const rejected = [];
  for (const r of removals) {
    const uncommitted = r.paths.some((p) => dirty.has(p));
    const trailers = uncommitted ? [] : removalTrailers(base.sha, opts.head, r.paths);
    const good = trailers.find((t) => t.reason);
    if (good) accepted.push({ ...r, sha: good.sha, reason: good.reason });
    else rejected.push({ ...r, why: uncommitted ? 'uncommitted' : trailers.length > 0 ? 'empty-reason' : 'no-trailer' });
  }

  const sha7 = base.sha.slice(0, 8);
  if (!opts.quiet || rejected.length > 0) {
    console.log(`removal ratchet: base ${sha7} (${base.label}); ${compared} changed verification file(s) compared`);
  }
  for (const a of accepted) {
    console.log(`  authorised: ${describe(a)} -- ${a.sha.slice(0, 8)} Check-removal: ${a.reason}`);
  }
  if (rejected.length === 0) {
    console.log('removal ratchet: PASS');
    return 0;
  }
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
  return 1;
}

const WHY = {
  'no-trailer': 'no commit in the branch that touches this file carries a "Check-removal: <reason>" trailer',
  'empty-reason': 'a Check-removal trailer is present but its reason is empty; say why the check is going',
  uncommitted: 'the file has uncommitted changes; commit it with a "Check-removal: <reason>" trailer, then re-run',
};

function describe(r) {
  if (r.deleted) {
    return r.before
      ? `${r.file}: deleted (was ${r.before.assertions} assertions, ${r.before.tests} tests)`
      : `${r.file}: deleted`;
  }
  return `${r.file}: assertions ${r.before.assertions} -> ${r.after.assertions}, tests ${r.before.tests} -> ${r.after.tests}`;
}

process.exitCode = main();
