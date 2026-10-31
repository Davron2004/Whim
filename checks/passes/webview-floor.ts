/**
 * static-check-pipeline — WebView floor. A mini-app runs in the device's Android System WebView,
 * which can be as old as `WEBVIEW_FLOOR_CHROMIUM`. esbuild lowers syntax to that engine but never
 * polyfills a built-in, so a call to one shipped later (`xs.at(-1)`, `Object.hasOwn`, `toSorted`)
 * renders on a current phone and throws a TypeError on an old one. Table-driven over
 * `POST_FLOOR_BUILTINS`; a static or global use counts only when its root resolves to the real
 * global, never to a shadowing local.
 *
 * `findPostFloorBuiltins` is also what the repo suite runs over the emitted runtime (SDK, React,
 * the sandbox scripts and every fixture bundle), so generated apps and the code that hosts them
 * answer to one table.
 */

import ts from 'typescript';
import { POST_FLOOR_BUILTINS, WEBVIEW_FLOOR_CHROMIUM, type PostFloorBuiltin } from '../contract';
import { CheckContext, Pass, lineOf, resolveBinding } from '../internal/scope';

export interface PostFloorUse {
  builtin: PostFloorBuiltin;
  /** `owner.name` for a static, `name` otherwise. */
  symbol: string;
  line: number;
  column: number;
}

const METHODS = new Map(POST_FLOOR_BUILTINS.filter((b) => b.form === 'method').map((b) => [b.name, b]));
const GLOBALS = new Map(POST_FLOOR_BUILTINS.filter((b) => b.form === 'global').map((b) => [b.name, b]));
const STATICS = new Map(POST_FLOOR_BUILTINS.filter((b) => b.form === 'static').map((b) => [`${b.owner}.${b.name}`, b]));

function isGlobal(node: ts.Expression, ctx: CheckContext): node is ts.Identifier {
  return ts.isIdentifier(node) && resolveBinding(node, ctx) === 'global';
}

/** Every use of a post-floor built-in in `ctx.sourceFile`, in source order. */
export function findPostFloorBuiltins(ctx: CheckContext): PostFloorUse[] {
  const uses: PostFloorUse[] = [];
  const add = (builtin: PostFloorBuiltin, symbol: string, node: ts.Node): void => {
    uses.push({ builtin, symbol, ...lineOf(ctx.sourceFile, node) });
  };

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = METHODS.get(node.expression.name.text);
      if (method) add(method, method.name, node.expression.name);
    }
    if (ts.isPropertyAccessExpression(node) && isGlobal(node.expression, ctx)) {
      const symbol = `${node.expression.text}.${node.name.text}`;
      const staticUse = STATICS.get(symbol);
      if (staticUse) add(staticUse, symbol, node);
    }
    if (ts.isIdentifier(node)) {
      const global = GLOBALS.get(node.text);
      if (global && resolveBinding(node, ctx) === 'global') add(global, global.name, node);
    }
    ts.forEachChild(node, visit);
  }

  visit(ctx.sourceFile);
  return uses;
}

export const webviewFloorPass: Pass = (ctx: CheckContext) => {
  for (const use of findPostFloorBuiltins(ctx)) {
    ctx.report({
      kind: 'post_floor_builtin',
      severity: 'error',
      line: use.line,
      column: use.column,
      symbol: use.symbol,
      message: `${use.symbol} needs Chromium ${use.builtin.chromium}; the app must also run in a WebView as old as Chromium ${WEBVIEW_FLOOR_CHROMIUM}, where it throws a TypeError.`,
      hint: `Write it without ${use.symbol}: ${use.builtin.instead}.`,
    });
  }
};
