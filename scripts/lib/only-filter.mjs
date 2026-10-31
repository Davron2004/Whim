/**
 * `--only <pattern>` for the Node suite runners (`npm run launcher:test -- --only haptic-moments-ui`).
 *
 * A red-check needs one suite, not the 8-10 minutes of all of them. Each runner bundles one
 * acceptance entry (`acceptance.ts`) that calls its suites in order; this plugin removes the calls
 * that do not match, so the acceptance files stay untouched and a new suite is filterable the day
 * it is added. A runner whose entry is a list of files (the SDK's) filters the list with
 * `matchesOnly` instead.
 *
 * What the filter sees, in the entry's statements (at any depth, not inside a kept call):
 *   - `[await] runFoo(...)` / `testFoo(...)`, where `runFoo`/`testFoo` is a named import from a
 *     sibling module (`./foo.suite`) or a function declared in the entry. Its name is that module
 *     specifier (or the function name); a pattern also matches the function name with punctuation
 *     ignored, so `sweep-reach` finds `testSweepReach`. Calls inside arrow functions are not
 *     statements of the entry's flow and are never filtered. A suite function declared in the entry
 *     is decided at its CALL and then runs whole or not at all: its body is never filtered, and a
 *     pattern that matches one of its `test('title')` titles keeps the call.
 *   - `[await] test('title', ...)`. Its name is the title (the single-file suites: bridge, version
 *     store, storage engine).
 * A pattern is a case-insensitive substring of a name. A pattern list that keeps nothing is an
 * ERROR (exit 1, "no suite matched"): a filter that matches nothing must never look like a pass.
 * Tests that lean on state an earlier, filtered-out test left behind will fail; that is the price
 * of running one suite alone. The filter works on source text, so each runner's final report also
 * fails a `--only` run that executed no test (`only-ran.mjs`): `parseOnly` arms that backstop.
 */
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { ONLY_ENV } from './only-ran.mjs';

/** The `--only` patterns in `argv` (repeatable, comma-separated, `--only=x` too), or null. */
export function parseOnly(argv = process.argv.slice(2)) {
  const patterns = [];
  let seen = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    let value;
    if (arg === '--only') value = argv[++i];
    else if (arg.startsWith('--only=')) value = arg.slice('--only='.length);
    else continue;
    seen = true;
    for (const part of (value ?? '').split(',')) if (part.trim()) patterns.push(part.trim());
  }
  if (!seen) return null;
  if (patterns.length === 0) {
    console.error('--only needs a pattern, e.g. --only haptic-moments-ui');
    process.exit(2);
  }
  process.env[ONLY_ENV] = '1';
  return patterns;
}

const squash = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Whether any pattern is a case-insensitive substring of `name`, or (when `fnName` is given) of it with punctuation ignored. */
export function matchesOnly(patterns, name, fnName) {
  const lower = name.toLowerCase();
  return patterns.some((p) => lower.includes(p.toLowerCase()) || (fnName !== undefined && squash(p) !== '' && squash(fnName).includes(squash(p))));
}

/** Exits 1 when nothing was kept, or when any one pattern matched nothing (`--only observers,obsrvrs`
 *  must fail on the typo, not run `observers` quietly). `unmatched` is the patterns that matched no
 *  suite; by default those matching none of the `kept` names. `available` helps the typo. */
export function requireMatched(patterns, kept, available, unmatched = patterns.filter((p) => !kept.some((name) => matchesOnly([p], name)))) {
  if (kept.length > 0 && unmatched.length === 0) return;
  console.error(kept.length === 0 ? `no suite matched --only ${patterns.join(',')}` : `no suite matched --only ${unmatched.join(',')} (the other patterns did)`);
  const shown = available.slice(0, 40).map((name) => (name.length > 70 ? `${name.slice(0, 70)}…` : name));
  if (shown.length > 0) console.error(`available: ${shown.join(', ')}${available.length > shown.length ? ', …' : ''}`);
  process.exit(1);
}

const SUITE_FN = /^(run|test)[A-Z]/;

/** The literal titles of the `test('title', ...)` calls anywhere under `node`. */
function collectTitles(ts, node, titles = []) {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'test') {
    const title = node.arguments[0];
    if (title && (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title))) titles.push(title.text);
  }
  ts.forEachChild(node, (child) => {
    collectTitles(ts, child, titles);
  });
  return titles;
}

/** `[name, module]` for each suite function a sibling-module import declaration brings in. */
function suiteImports(ts, stmt) {
  if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) return [];
  const spec = stmt.moduleSpecifier.text;
  const bindings = stmt.importClause?.namedBindings;
  if (!spec.startsWith('./') || spec.endsWith('/harness') || !bindings || !ts.isNamedImports(bindings)) return [];
  return bindings.elements.filter((el) => SUITE_FN.test(el.name.text)).map((el) => [el.name.text, spec.slice(2)]);
}

/** The suite functions of the entry: name to module specifier (or own name), and local suites' titles. */
function findSuites(ts, sf) {
  const suiteModule = new Map();
  const localTitles = new Map();
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && SUITE_FN.test(stmt.name.text)) {
      suiteModule.set(stmt.name.text, stmt.name.text);
      localTitles.set(stmt.name.text, stmt.body ? collectTitles(ts, stmt.body) : []);
    }
    for (const [name, spec] of suiteImports(ts, stmt)) suiteModule.set(name, spec);
  }
  return { suiteModule, localTitles };
}

/** `{ code, kept, dropped, unmatched }`: `source` with the unit statements that match no pattern removed,
 *  and the patterns that matched no unit at all. */
export async function filterSource(source, patterns, fileName = 'entry.ts') {
  const ts = (await import('typescript')).default;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const { suiteModule, localTitles } = findSuites(ts, sf);

  const kept = [];
  const dropped = [];
  const matched = new Set();
  const edits = [];
  const unitName = (expression) => {
    let e = expression;
    while (ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e)) e = e.expression;
    if (!ts.isCallExpression(e) || !ts.isIdentifier(e.expression)) return null;
    const callee = e.expression.text;
    if (suiteModule.has(callee)) return { name: suiteModule.get(callee), fnName: callee, titles: localTitles.get(callee) ?? [] };
    const title = e.arguments[0];
    if (callee === 'test' && title && (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title))) return { name: title.text, titles: [] };
    return null;
  };
  const visit = (node) => {
    if (ts.isExpressionStatement(node)) {
      const unit = unitName(node.expression);
      if (unit !== null) {
        const hit = patterns.filter((p) => matchesOnly([p], unit.name, unit.fnName) || unit.titles.some((title) => matchesOnly([p], title)));
        for (const p of hit) matched.add(p);
        if (hit.length > 0) kept.push(unit.name);
        else {
          dropped.push(unit.name);
          edits.push([node.getStart(sf), node.end]);
        }
        return;
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name && localTitles.has(node.name.text)) return;
    if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) ts.forEachChild(node, visit);
  };
  visit(sf);

  let code = source;
  for (const [start, end] of edits.toReversed()) code = `${code.slice(0, start)};${code.slice(end)}`;
  return { code, kept, dropped, unmatched: patterns.filter((p) => !matched.has(p)) };
}

/** `{ plugin, assertMatched }` for an esbuild build whose entry is `entry`. */
export function entryFilter(entry, patterns) {
  let result = null;
  const realEntry = realpathSync(entry);
  return {
    plugin: {
      name: 'only-filter',
      setup(build) {
        build.onLoad({ filter: /\.tsx?$/ }, async (args) => {
          if (realpathSync(args.path) !== realEntry) return undefined;
          result = await filterSource(await readFile(entry, 'utf8'), patterns, entry);
          return { contents: result.code, loader: entry.endsWith('x') ? 'tsx' : 'ts' };
        });
      },
    },
    assertMatched() {
      requireMatched(patterns, result?.kept ?? [], [...new Set(result?.dropped ?? [])], result?.unmatched ?? patterns);
    },
  };
}
