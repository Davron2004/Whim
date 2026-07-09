/**
 * static-check-pipeline — forbidden-global walk (task 4.2, spec "Forbidden-global walk closes
 * T8", decisions #37/T8). Binding resolution, not token matching: flags direct references,
 * member/computed access through a global root or a tainted alias (including a
 * statically-unknown computed key), `.constructor` access, `__proto__`/shared-prototype
 * mutation, and string-argument `setTimeout`/`setInterval`. Honest shadowing (task 4.3) is
 * never flagged — `resolveBinding` returning `'local'` is always skipped.
 */

import ts from 'typescript';
import { Diagnostic, DiagnosticKind, FORBIDDEN_DIRECT_NAMES, FORBIDDEN_MEMBER_PATHS, GLOBAL_ROOTS } from '../contract';
import { CheckContext, Pass, lineOf, resolveBinding, rootIdentifierOf } from '../internal/scope';

const DIRECT_FORBIDDEN_NAMES: ReadonlySet<string> = new Set([...FORBIDDEN_DIRECT_NAMES, ...GLOBAL_ROOTS]);
const GLOBAL_ROOT_NAMES: ReadonlySet<string> = new Set(GLOBAL_ROOTS);

function hintFor(name: string): string {
  if (name === 'eval' || name === 'Function' || name === 'constructor') {
    return 'Dynamic code generation is blocked by the sandbox CSP and has no vc-sdk equivalent — remove this call.';
  }
  if (name === 'document' || GLOBAL_ROOT_NAMES.has(name)) {
    return 'Mini-apps render only through vc-sdk components (Screen/Stack/Text/...) — direct DOM/global access is not available.';
  }
  if (name === 'fetch' || name === 'XMLHttpRequest' || name === 'WebSocket' || name === 'EventSource' || name === 'RTCPeerConnection' || name === 'sendBeacon') {
    return "Network access is not exposed to mini-apps; persist data with vc-sdk's `storage` capability instead.";
  }
  if (name === 'localStorage' || name === 'sessionStorage' || name === 'indexedDB' || name === 'caches') {
    return "Ambient persistence is blocked; use vc-sdk's `storage` capability instead.";
  }
  if (name === 'Worker' || name === 'SharedWorker') {
    return "Background threads are not available; use vc-sdk's `delay`/`interval` for async work instead.";
  }
  return "This global is not reachable from a vc-sdk mini-app; use the equivalent vc-sdk capability instead.";
}

function report(
  ctx: CheckContext,
  kind: DiagnosticKind,
  node: ts.Node,
  symbol: string,
  message: string,
  hint: string,
): void {
  const { line, column } = lineOf(ctx.sourceFile, node);
  const d: Diagnostic = { kind, severity: 'error', line, column, symbol, message, hint };
  ctx.report(d);
}

function isPrototypeTargetExpr(expr: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(expr) && expr.name.text === 'prototype';
}

function isForbiddenPrototypeCall(node: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  const obj = node.expression.expression;
  if (!ts.isIdentifier(obj) || obj.text !== 'Object') return false;
  const method = node.expression.name.text;
  if (method !== 'defineProperty' && method !== 'setPrototypeOf' && method !== 'assign') return false;
  const target = node.arguments[0];
  return !!target && isPrototypeTargetExpr(target);
}

function isStringArg(expr: ts.Expression | undefined): boolean {
  if (!expr) return false;
  if (ts.isStringLiteralLike(expr)) return true;
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return isStringArg(expr.left) || isStringArg(expr.right);
  }
  return false;
}

/** Shared by both member-access checks: an access whose root resolves to a tainted alias
 *  (`const g = globalThis; g.fetch(...)`) reaches a forbidden global indirectly. */
function checkMemberBase(ctx: CheckContext, access: ts.PropertyAccessExpression | ts.ElementAccessExpression): void {
  const root = rootIdentifierOf(access.expression);
  if (!root) return;
  const binding = resolveBinding(root, ctx);
  if (binding === 'tainted') {
    report(
      ctx,
      'forbidden_global',
      access,
      root.text,
      `Member/computed access reaches a forbidden global through the alias "${root.text}".`,
      hintFor(root.text),
    );
  }
}

/** `.constructor`, `.__proto__`, a forbidden member path (`navigator.sendBeacon`), or a
 *  member/computed access through a tainted alias — mutually exclusive, first match wins. */
function checkPropertyAccess(ctx: CheckContext, node: ts.PropertyAccessExpression): void {
  if (node.name.text === 'constructor') {
    report(ctx, 'forbidden_global', node, 'constructor', '`.constructor` access can walk to Function/eval.', hintFor('constructor'));
    return;
  }
  if (node.name.text === '__proto__') {
    report(ctx, 'prototype_pollution', node, '__proto__', '`__proto__` access mutates a shared prototype.', hintFor('__proto__'));
    return;
  }
  for (const path of FORBIDDEN_MEMBER_PATHS) {
    if (path.length === 2 && node.name.text === path[1]) {
      const rootExpr = node.expression;
      if (ts.isIdentifier(rootExpr) && rootExpr.text === path[0] && resolveBinding(rootExpr, ctx) === 'global') {
        report(ctx, 'forbidden_global', node, path.join('.'), `"${path.join('.')}" is a forbidden member path.`, hintFor(path[1]));
      }
    }
  }
  checkMemberBase(ctx, node);
}

/** `obj['__proto__']` (computed prototype pollution), or a computed access through a tainted
 *  alias — same two shapes `checkPropertyAccess` covers, for the element-access syntax. */
function checkElementAccess(ctx: CheckContext, node: ts.ElementAccessExpression): void {
  if (ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === '__proto__') {
    report(ctx, 'prototype_pollution', node, '__proto__', '`__proto__` access mutates a shared prototype.', hintFor('__proto__'));
  } else {
    checkMemberBase(ctx, node);
  }
}

/** `Object.defineProperty/setPrototypeOf/assign` onto a shared prototype, or a
 *  string-argument `setTimeout`/`setInterval` (implicit eval). */
function checkCallExpression(ctx: CheckContext, node: ts.CallExpression): void {
  if (isForbiddenPrototypeCall(node)) {
    report(ctx, 'prototype_pollution', node, 'Object.prototype', 'This call mutates a shared prototype.', hintFor('__proto__'));
  } else if (ts.isIdentifier(node.expression) && (node.expression.text === 'setTimeout' || node.expression.text === 'setInterval')) {
    if (resolveBinding(node.expression, ctx) === 'global' && isStringArg(node.arguments[0])) {
      report(
        ctx,
        'implicit_eval',
        node,
        node.expression.text,
        `String-argument ${node.expression.text} is implicit eval.`,
        'Pass a function, not a string, to the timer — or use vc-sdk\'s `delay`/`interval`.',
      );
    }
  }
}

export const forbiddenGlobalsPass: Pass = (ctx: CheckContext) => {
  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node)) {
      const binding = resolveBinding(node, ctx);
      if (binding === 'global' && DIRECT_FORBIDDEN_NAMES.has(node.text)) {
        report(ctx, 'forbidden_global', node, node.text, `"${node.text}" is a forbidden global.`, hintFor(node.text));
      }
      return;
    }

    if (ts.isPropertyAccessExpression(node)) {
      checkPropertyAccess(ctx, node);
      ts.forEachChild(node, visit);
      return;
    }

    if (ts.isElementAccessExpression(node)) {
      checkElementAccess(ctx, node);
      ts.forEachChild(node, visit);
      return;
    }

    if (ts.isCallExpression(node)) {
      checkCallExpression(ctx, node);
    }

    ts.forEachChild(node, visit);
  }

  visit(ctx.sourceFile);
};
