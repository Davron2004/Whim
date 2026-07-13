/**
 * static-check-pipeline — screen graph resolution (task 5.3, spec "Screen graph resolves
 * statically"). `initial` must name a key of `screens`. Target resolution is table-driven:
 * a matching call's string-literal argument must name a declared screen; a non-literal argument
 * is rejected outright (the same conservative policy as computed global access).
 *
 * Runs only when `ctx.manifest` is set.
 */

import ts from 'typescript';
import { Diagnostic, NAV_CALL_SHAPES } from '../contract';
import { CheckContext, Pass, lineOf, resolvesToImport } from '../internal/scope';
import { getProperty } from '../internal/manifest';

const VC_SDK_SPECIFIER = 'vc-sdk';

function declaredScreensList(screens: Record<string, true>): string {
  const names = Object.keys(screens);
  return names.length > 0 ? names.join(', ') : '(none declared)';
}

/**
 * `shape.object` is the name exported by vc-sdk, not the spelling at the call site. A named
 * import may be aliased (`nav as router`), while a namespace import exposes the same export as
 * the exact `sdk.nav` member. Lexical resolution excludes unrelated and shadowing bindings.
 */
function resolvesToNavObject(expression: ts.Expression, ctx: CheckContext, exportedName: string): boolean {
  if (ts.isIdentifier(expression)) {
    return resolvesToImport(expression, ctx, VC_SDK_SPECIFIER, exportedName);
  }
  return (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === exportedName &&
    ts.isIdentifier(expression.expression) &&
    resolvesToImport(expression.expression, ctx, VC_SDK_SPECIFIER, '*')
  );
}

export const screenGraphPass: Pass = (ctx: CheckContext) => {
  const manifest = ctx.manifest;
  if (!manifest) return;
  const { sourceFile } = ctx;
  const screens = manifest.screens;
  const initial = manifest.initial;
  const hint = `Declared screens: ${declaredScreensList(screens)}.`;

  if (!(initial in screens)) {
    const prop = ctx.manifestArgumentNode ? getProperty(ctx.manifestArgumentNode, 'initial') : undefined;
    const node = prop && ts.isPropertyAssignment(prop) ? prop.initializer : (ctx.manifestArgumentNode ?? sourceFile);
    const { line, column } = lineOf(sourceFile, node);
    const d: Diagnostic = {
      kind: 'unresolved_screen',
      severity: 'error',
      line,
      column,
      symbol: initial,
      message: `"initial" names "${initial}", which is not a declared screen.`,
      hint,
    };
    ctx.report(d);
  }

  if (NAV_CALL_SHAPES.length === 0) return;

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const objExpr = node.expression.expression;
      const methodName = node.expression.name.text;
      for (const shape of NAV_CALL_SHAPES) {
        if (shape.method !== methodName || !resolvesToNavObject(objExpr, ctx, shape.object)) continue;
        const arg = node.arguments[shape.argIndex];
        if (!arg || !ts.isStringLiteralLike(arg)) {
          const { line, column } = lineOf(sourceFile, arg ?? node);
          ctx.report({
            kind: 'unresolved_screen',
            severity: 'error',
            line,
            column,
            message: 'Navigation target must be a string literal naming a declared screen.',
            hint,
          });
          continue;
        }
        if (!(arg.text in screens)) {
          const { line, column } = lineOf(sourceFile, arg);
          ctx.report({
            kind: 'unresolved_screen',
            severity: 'error',
            line,
            column,
            symbol: arg.text,
            message: `Navigation target "${arg.text}" names no declared screen.`,
            hint,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
};
