#!/usr/bin/env node
// Compound-command unroller for bash-policy.sh (openspec: compound-command-policy).
//
// Reads ONE command line on stdin; writes a JSON verdict on stdout:
//   {"unrollable":true,"segments":[...],"redirects":[...]}  — split into simple commands
//   {"unrollable":false,"reason":"..."}                     — fail closed; caller keeps prior behavior
//
// Contract (design.md §D1):
//   * A command joined by TOP-LEVEL `&&`, `||`, `;`, `|` is unrolled into its simple commands.
//     Each `segments[]` entry is the ORIGINAL substring between connectors, trimmed — quoting is
//     PRESERVED, never re-joined from stripped words (re-joining would let `-m "git push origin
//     main"` smuggle a fake push into the re-evaluated text).
//   * `>` / `>>` targets are extracted (dequoted) into `redirects[]` as pseudo-writes so the caller
//     can deny redirects into protected paths (shell redirects bypass the Edit/Write hook).
//   * A command whose identity depends on RUNTIME OUTPUT is unsound to judge piecewise, so command
//     substitution (`$(…)`, backticks), parameter/arith expansion (`$…`), eval-family / indirection
//     wrappers in command position (bash -c, sh -c, eval, xargs, env, …), assignment prefixes
//     (`NAME=val cmd`), process substitution (`<(…)`, `>(…)`), subshell/brace grouping, escapes,
//     heredocs, and ANY byte the strict tokenizer does not recognize all yield unrollable:false.
//   * The caller ALWAYS falls closed to a prompt on unrollable:false — never to allow. This helper
//     is therefore only ever a way to make MORE things auditable, never a way to auto-allow.

// Word bytes that are inert for command identity — globs stay literal because we CLASSIFY, we do not
// execute. Everything outside this set (and outside quotes) must be a recognized operator or refuse.
const WORD = /[A-Za-z0-9_.\/:=,@%+^~*?[\]-]/;

// Commands whose first word hands control to a runtime-computed command line. `env`, `time`,
// `nohup`, `timeout`, etc. also re-wrap a following command, so the "real" segment is indirected.
const EVAL_WRAPPERS = new Set([
  'bash', 'sh', 'zsh', 'dash', 'eval', 'exec', 'source', 'command',
  'xargs', 'env', 'time', 'nohup', 'timeout', 'nice', 'ionice', 'watch', 'sudo',
]);

function refuse(reason) {
  process.stdout.write(JSON.stringify({ unrollable: false, reason }) + '\n');
  process.exit(0);
}

// Scan one shell word starting at `k` (after skipping leading blanks). Returns {word, end} with the
// DEQUOTED word text, or null if there is no word / an unsound byte appears inside it.
function captureWord(s, k) {
  while (k < s.length && (s[k] === ' ' || s[k] === '\t')) k++;
  if (k >= s.length) return null;
  let word = '';
  while (k < s.length) {
    const c = s[k];
    if (c === ' ' || c === '\t' || c === '&' || c === '|' || c === ';' ||
        c === '>' || c === '<' || c === '(' || c === ')') break;
    if (c === "'") {
      let j = k + 1;
      while (j < s.length && s[j] !== "'") j++;
      if (j >= s.length) return null;
      word += s.slice(k + 1, j);
      k = j + 1;
      continue;
    }
    if (c === '"') {
      let j = k + 1;
      while (j < s.length && s[j] !== '"') {
        if (s[j] === '\\') { if (s[j + 1] === undefined) return null; word += s[j + 1]; j += 2; continue; }
        if (s[j] === '$' || s[j] === '`') return null;
        word += s[j];
        j++;
      }
      if (j >= s.length) return null;
      k = j + 1;
      continue;
    }
    if (c === '$' || c === '`' || c === '\\' || c === '{' || c === '}') return null;
    if (!WORD.test(c)) return null;
    word += c;
    k++;
  }
  if (word === '') return null;
  return { word, end: k };
}

// The dequoted first word of a segment, for the command-position guard.
function firstToken(seg) {
  const w = captureWord(seg, 0);
  return w ? w.word : seg;
}

function main(input) {
  const s = input.replace(/\n+$/, '');
  if (s.includes('\n')) return refuse('embedded newline');

  const segments = [];
  const redirects = [];
  let segStart = 0;

  const emitSegment = (endExclusive) => {
    const seg = s.slice(segStart, endExclusive).trim();
    if (seg === '') return refuse('empty segment (dangling connector)');
    const first = firstToken(seg);
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) return refuse('assignment prefix in command position');
    const base = first.replace(/^.*\//, '');
    if (EVAL_WRAPPERS.has(base)) return refuse(`eval-family/indirection wrapper in command position: ${base}`);
    segments.push(seg);
  };

  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];

    if (c === "'") {
      let j = i + 1;
      while (j < n && s[j] !== "'") j++;
      if (j >= n) return refuse('unterminated single quote');
      i = j + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n && s[j] !== '"') {
        if (s[j] === '\\') { if (s[j + 1] === undefined) return refuse('unterminated double quote'); j += 2; continue; }
        if (s[j] === '$') return refuse('parameter/command expansion in double quotes');
        if (s[j] === '`') return refuse('command substitution (backtick) in double quotes');
        j++;
      }
      if (j >= n) return refuse('unterminated double quote');
      i = j + 1;
      continue;
    }

    if (c === '$') return refuse('parameter/command expansion');
    if (c === '`') return refuse('command substitution (backtick)');
    if (c === '\\') return refuse('backslash escape outside quotes');
    if (c === '(' || c === ')' || c === '{' || c === '}') return refuse('grouping / subshell / brace / process substitution');

    if (c === '&') {
      if (s[i + 1] === '&') { emitSegment(i); segStart = i + 2; i += 2; continue; }
      return refuse('background & / fd-dup (&>)');
    }
    if (c === '|') {
      // Both `||` and a single pipe `|` are segment boundaries (each side judged independently).
      if (s[i + 1] === '|') { emitSegment(i); segStart = i + 2; i += 2; continue; }
      emitSegment(i); segStart = i + 1; i += 1; continue;
    }
    if (c === ';') {
      if (s[i + 1] === ';') return refuse('case terminator ;;');
      emitSegment(i); segStart = i + 1; i += 1; continue;
    }

    if (c === '>') {
      let k = i + 1;
      if (s[k] === '>') k += 1;
      else if (s[k] === '&' || s[k] === '(') return refuse('fd-dup (>&) / process substitution (>())');
      const t = captureWord(s, k);
      if (t === null) return refuse('output redirection without a plain target');
      redirects.push(t.word);
      i = t.end;
      continue;
    }
    if (c === '<') {
      if (s[i + 1] === '<') return refuse('heredoc / herestring (<<)');
      if (s[i + 1] === '(') return refuse('process substitution (<())');
      const t = captureWord(s, i + 1);
      if (t === null) return refuse('input redirection without a plain target');
      i = t.end; // read target consumed and discarded (not a write)
      continue;
    }

    if (c === ' ' || c === '\t') { i++; continue; }
    if (WORD.test(c)) { i++; continue; }
    return refuse(`unrecognized character: ${JSON.stringify(c)}`);
  }
  emitSegment(n);

  process.stdout.write(JSON.stringify({ unrollable: true, segments, redirects }) + '\n');
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { buf += d; });
process.stdin.on('end', () => main(buf));
