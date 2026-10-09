/**
 * Binding-provenance audit (capability-bridge: "The fast gate statically rejects unguarded
 * Playwright host bindings"). Repo harness code, not a mini-app pass: it is deliberately not a
 * `Pass` and is never registered in `checks/index.ts`'s PASSES, whose pipeline scores one
 * candidate bundle and would reject a harness file's `playwright` import before asking this.
 *
 * Playwright installs a page binding on the global of EVERY execution context, the opaque-origin
 * sandboxed iframe included, and the name can be re-minted there through Playwright's binding
 * controller. So the only sound host binding is `exposeBinding` whose callback refuses, as its
 * first statement, any call whose browser-derived `source.frame` is not the main frame.
 * `exposeFunction` is `exposeBinding` with that source thrown away, so it is banned outright.
 *
 * Rules, AST-only, over every source file under the repo's code roots (not only files importing
 * `playwright`: a helper handed a `page` need not import it, and both method names are
 * Playwright's own):
 *   - expose-function    any reference to `exposeFunction`.
 *   - binding-not-inline an `exposeBinding` reference that is not a direct call with an inline
 *                        function callback with a block body (nothing else can be verified).
 *   - guard-not-first    the callback's first statement is not
 *                        `if (<src>.frame !== <page>.mainFrame()) { ...; return [null]; }`, where
 *                        `<page>` is a plain identifier or `<src>.page`, and the refusal branch
 *                        reads none of the call's other arguments (the payload).
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export type BindingRule = 'expose-function' | 'binding-not-inline' | 'guard-not-first';

export interface BindingViolation {
  /** Repo-relative, `/`-separated. */
  readonly file: string;
  /** 1-based. */
  readonly line: number;
  readonly rule: BindingRule;
}

export interface BindingSite {
  readonly file: string;
  readonly line: number;
}

export interface AuditResult {
  /** Every `exposeBinding` call that passed the guard rule. */
  readonly guarded: BindingSite[];
  readonly violations: BindingViolation[];
}

const SOURCE_FILE = /\.(?:[cm]?[jt]s|tsx)$/;
/** Top-level directories that are not code roots: native projects and prose. `node_modules` and
 *  dot-dirs (VCS, tool state, other worktrees) are skipped at any depth. */
const SKIPPED_TOP_DIRS = new Set(['android', 'ios', 'openspec', 'docs']);

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  return /\.[cm]?ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
}

function unwrap(node: ts.Expression): ts.Expression {
  let e = node;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  return e;
}

/** The name a property access / element access / binding element refers to, if static. */
function memberName(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text;
  if (ts.isBindingElement(node)) {
    const key = node.propertyName ?? node.name;
    return ts.isIdentifier(key) || ts.isStringLiteralLike(key) ? key.text : undefined;
  }
  return undefined;
}

/** Matches `<src>.frame` (or the destructured `frame` local) for the callback's first parameter. */
function isSourceFrame(expr: ts.Expression, source: ts.ParameterDeclaration): boolean {
  const e = unwrap(expr);
  if (ts.isIdentifier(source.name)) {
    return ts.isPropertyAccessExpression(e) && e.name.text === 'frame' && ts.isIdentifier(e.expression) && e.expression.text === source.name.text;
  }
  if (ts.isObjectBindingPattern(source.name) && ts.isIdentifier(e)) {
    return source.name.elements.some((el) => memberName(el) === 'frame' && ts.isIdentifier(el.name) && el.name.text === e.text);
  }
  return false;
}

/** Matches `<page>.mainFrame()` where `<page>` is an identifier or `<src>.page`. */
function isMainFrameCall(expr: ts.Expression, source: ts.ParameterDeclaration): boolean {
  const e = unwrap(expr);
  if (!ts.isCallExpression(e) || e.arguments.length !== 0 || !ts.isPropertyAccessExpression(e.expression)) return false;
  if (e.expression.name.text !== 'mainFrame') return false;
  const owner = unwrap(e.expression.expression);
  if (ts.isIdentifier(owner)) return true;
  return (
    ts.isPropertyAccessExpression(owner) &&
    owner.name.text === 'page' &&
    ts.isIdentifier(owner.expression) &&
    ts.isIdentifier(source.name) &&
    owner.expression.text === source.name.text
  );
}

function isRefusingReturn(stmt: ts.Statement | undefined): boolean {
  if (stmt === undefined || !ts.isReturnStatement(stmt)) return false;
  const value = stmt.expression && unwrap(stmt.expression);
  return (
    value === undefined ||
    value.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(value) && value.text === 'undefined') ||
    (ts.isVoidExpression(value) && ts.isNumericLiteral(unwrap(value.expression)))
  );
}

/** True when `node` mentions any of `names` as an identifier. */
function mentions(node: ts.Node, names: ReadonlySet<string>): boolean {
  if (ts.isIdentifier(node) && names.has(node.text)) return true;
  return ts.forEachChild(node, (child) => (mentions(child, names) ? true : undefined)) ?? false;
}

function boundNames(name: ts.BindingName, out: Set<string>): void {
  if (ts.isIdentifier(name)) out.add(name.text);
  else for (const el of name.elements) if (!ts.isOmittedExpression(el)) boundNames(el.name, out);
}

function isProvenanceGuard(stmt: ts.Statement | undefined, fn: ts.ArrowFunction | ts.FunctionExpression): boolean {
  const source = fn.parameters[0];
  if (stmt === undefined || source === undefined || !ts.isIfStatement(stmt)) return false;
  const cond = unwrap(stmt.expression);
  if (!ts.isBinaryExpression(cond)) return false;
  const op = cond.operatorToken.kind;
  if (op !== ts.SyntaxKind.ExclamationEqualsEqualsToken && op !== ts.SyntaxKind.ExclamationEqualsToken) return false;
  const shaped =
    (isSourceFrame(cond.left, source) && isMainFrameCall(cond.right, source)) ||
    (isSourceFrame(cond.right, source) && isMainFrameCall(cond.left, source));
  if (!shaped) return false;
  const refusal = ts.isBlock(stmt.thenStatement) ? stmt.thenStatement.statements : [stmt.thenStatement];
  if (!isRefusingReturn(refusal[refusal.length - 1])) return false;
  const payload = new Set<string>();
  for (const p of fn.parameters.slice(1)) boundNames(p.name, payload);
  return !mentions(stmt.thenStatement, payload);
}

/** Audit one file's source text. `file` is the repo-relative path; its extension picks the parser. */
export function auditSource(file: string, text: string): AuditResult {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const guarded: BindingSite[] = [];
  const violations: BindingViolation[] = [];
  const lineOf = (node: ts.Node): number => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  const visit = (node: ts.Node): void => {
    const name = memberName(node);
    if (name === 'exposeFunction') {
      violations.push({ file, line: lineOf(node), rule: 'expose-function' });
    } else if (name === 'exposeBinding') {
      const call = node.parent;
      const isCallee = ts.isCallExpression(call) && call.expression === node;
      const cb = isCallee ? call.arguments[1] : undefined;
      const fn = cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) && ts.isBlock(cb.body) ? cb : undefined;
      if (fn === undefined) {
        violations.push({ file, line: lineOf(node), rule: 'binding-not-inline' });
      } else if (isProvenanceGuard((fn.body as ts.Block).statements[0], fn)) {
        guarded.push({ file, line: lineOf(node) });
      } else {
        violations.push({ file, line: lineOf(node), rule: 'guard-not-first' });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { guarded, violations };
}

/** Audit every source file under `root`. A text pre-filter only skips files that cannot name
 *  either method; whether a mention is a violation is decided on the AST. */
export function auditRepo(root: string): AuditResult {
  const guarded: BindingSite[] = [];
  const violations: BindingViolation[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && !(dir === root && SKIPPED_TOP_DIRS.has(entry.name))) walk(full);
        continue;
      }
      if (!entry.isFile() || !SOURCE_FILE.test(entry.name) || entry.name.endsWith('.d.ts')) continue;
      const text = fs.readFileSync(full, 'utf8');
      if (!text.includes('exposeFunction') && !text.includes('exposeBinding')) continue;
      const result = auditSource(path.relative(root, full).split(path.sep).join('/'), text);
      guarded.push(...result.guarded);
      violations.push(...result.violations);
    }
  };
  walk(root);
  return { guarded, violations };
}
