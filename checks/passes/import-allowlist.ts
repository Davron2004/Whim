/**
 * static-check-pipeline — import allowlist (task 3.3, spec "Imports resolve only to vc-sdk").
 *
 * Every static import specifier SHALL be exactly `vc-sdk`. `require(...)` and dynamic
 * `import(...)` are rejected outright, regardless of specifier.
 */

import ts from 'typescript';
import { Diagnostic } from '../contract';
import { CheckContext, Pass, lineOf } from '../internal/scope';

const ALLOWED_SPECIFIER = 'vc-sdk';

interface ImportRejection {
  symbol: string;
  message: string;
  hint: string;
}

function importRejectionDiagnostic(sourceFile: ts.SourceFile, node: ts.Node, rejection: ImportRejection): Diagnostic {
  const { line, column } = lineOf(sourceFile, node);
  return {
    kind: 'disallowed_import',
    severity: 'error',
    line,
    column,
    ...rejection,
  };
}

function offAllowlistDiagnostic(sourceFile: ts.SourceFile, node: ts.Node, specifier: string): Diagnostic {
  return importRejectionDiagnostic(sourceFile, node, {
    symbol: specifier,
    message: `Import specifier "${specifier}" is not on the allowlist.`,
    hint: `Only "import ... from 'vc-sdk'" is allowed — replace "${specifier}" with 'vc-sdk'.`,
  });
}

function requireDiagnostic(sourceFile: ts.SourceFile, node: ts.Node): Diagnostic {
  return importRejectionDiagnostic(sourceFile, node, {
    symbol: 'require',
    message: 'require(...) is not allowed.',
    hint: "Use a static \"import ... from 'vc-sdk'\" instead of require(...).",
  });
}

function dynamicImportDiagnostic(sourceFile: ts.SourceFile, node: ts.Node): Diagnostic {
  return importRejectionDiagnostic(sourceFile, node, {
    symbol: 'import()',
    message: 'Dynamic import() is not allowed.',
    hint: "Use a static \"import ... from 'vc-sdk'\" instead of import().",
  });
}

/** `import(...)` parses as a `CallExpression` whose callee is the `import` keyword token —
 *  `ts.isImportCall` exists at runtime but is `@internal` (absent from the public `.d.ts`), so
 *  this checks the public `SyntaxKind` field directly instead. */
function isDynamicImportCall(node: ts.CallExpression): boolean {
  return node.expression.kind === ts.SyntaxKind.ImportKeyword;
}

export const importAllowlistPass: Pass = (ctx: CheckContext) => {
  const { sourceFile } = ctx;

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (ts.isStringLiteralLike(specifier) && specifier.text !== ALLOWED_SPECIFIER) {
        ctx.report(offAllowlistDiagnostic(sourceFile, specifier, specifier.text));
      }
    } else if (ts.isCallExpression(node)) {
      if (isDynamicImportCall(node)) {
        ctx.report(dynamicImportDiagnostic(sourceFile, node));
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        ctx.report(requireDiagnostic(sourceFile, node));
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
};
