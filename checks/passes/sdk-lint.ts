/**
 * static-check-pipeline — SDK lint (task 6.1, spec "SDK lint steers toward the taught path").
 * Table-driven over `SDK_LINT_RULES`: a raw `setTimeout`/`setInterval`/`requestAnimationFrame`
 * call with a function-argument (not string-argument — that's `forbidden-globals.ts`'s
 * `implicit_eval`, task 4.2) draws a warning steering to the SDK's `delay`/`interval`.
 * Reuses `resolveBinding` to confirm the callee is the real global, not a shadowed local
 * (same guard `forbidden-globals.ts` already applies for the string-argument case).
 */

import ts from 'typescript';
import { Diagnostic, SDK_LINT_RULES } from '../contract';
import { CheckContext, Pass, lineOf, resolveBinding } from '../internal/scope';

export const sdkLintPass: Pass = (ctx: CheckContext) => {
  const { sourceFile } = ctx;

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const calleeName = node.expression.text;
      const rule = SDK_LINT_RULES.find((r) => r.globalName === calleeName);
      if (rule && resolveBinding(node.expression, ctx) === 'global') {
        const arg0 = node.arguments[0];
        if (arg0 && (ts.isArrowFunction(arg0) || ts.isFunctionExpression(arg0))) {
          const { line, column } = lineOf(sourceFile, node);
          const d: Diagnostic = {
            kind: 'raw_timer',
            severity: 'warning',
            line,
            column,
            symbol: rule.globalName,
            message: `Raw ${rule.globalName}(...) is used instead of the vc-sdk equivalent.`,
            hint: `Use vc-sdk's \`${rule.sdkAlternative}\` instead of raw ${rule.globalName}.`,
          };
          ctx.report(d);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
};
