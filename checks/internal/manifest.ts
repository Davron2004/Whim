/**
 * static-check-pipeline — manifest extraction internals (task 5.1, spec "The app manifest is
 * extracted statically, literal-only"). Pure AST helpers shared by the manifest-extraction
 * pass and by the capability/screen/schema passes that need to relocate the same nodes for
 * line-accurate diagnostics — no engine logic, no execution.
 *
 * Dispatcher directive (adjudicated, see chain D report): `extractAppManifest` resolves a
 * same-module top-level `const` identifier initializer to its literal value (used by the
 * `schema` field so `schema: SCHEMA` — the real fixtures' shape — is not `manifest_not_static`).
 * `capabilities` deliberately does NOT get this treatment (spec scenario "Computed capabilities
 * rejected" requires `capabilities: someArray` to fail).
 */

import ts from 'typescript';

// ── JSON-literal conversion (schema field, capability array elements) ──────────────────────

export type JsonLiteral = null | boolean | number | string | JsonLiteral[] | { [k: string]: JsonLiteral };
type JsonConversion = { ok: true; value: JsonLiteral } | { ok: false };

function getLiteralPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

/** Converts an AST literal expression to a plain JS value. Anything not a closed literal shape
 *  (identifier reference, call result, spread, computed key, template with substitutions, …)
 *  fails — this is the "literal-only" boundary the spec requires. */
function primitiveLiteralToJson(expr: ts.Expression): JsonConversion | undefined {
  if (ts.isStringLiteralLike(expr)) return { ok: true, value: expr.text };
  if (ts.isNumericLiteral(expr)) return { ok: true, value: Number(expr.text) };
  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(expr.operand)
  ) {
    return { ok: true, value: -Number(expr.operand.text) };
  }
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return { ok: true, value: true };
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return { ok: true, value: false };
  if (expr.kind === ts.SyntaxKind.NullKeyword) return { ok: true, value: null };
  return undefined;
}

function arrayLiteralToJson(expr: ts.ArrayLiteralExpression): JsonConversion {
  const values: JsonLiteral[] = [];
  for (const el of expr.elements) {
    if (ts.isSpreadElement(el)) return { ok: false };
    const conv = literalToJson(el);
    if (!conv.ok) return { ok: false };
    values.push(conv.value);
  }
  return { ok: true, value: values };
}

function objectLiteralToJson(expr: ts.ObjectLiteralExpression): JsonConversion {
  const obj: { [k: string]: JsonLiteral } = {};
  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop)) return { ok: false }; // no spread/shorthand/methods
    const name = getLiteralPropertyName(prop.name);
    if (name === undefined) return { ok: false }; // computed/private key
    const conv = literalToJson(prop.initializer);
    if (!conv.ok) return { ok: false };
    obj[name] = conv.value;
  }
  return { ok: true, value: obj };
}

export function literalToJson(node: ts.Expression): JsonConversion {
  let expr = node;
  while (ts.isParenthesizedExpression(expr)) expr = expr.expression;

  const primitive = primitiveLiteralToJson(expr);
  if (primitive) return primitive;
  if (ts.isArrayLiteralExpression(expr)) return arrayLiteralToJson(expr);
  if (ts.isObjectLiteralExpression(expr)) return objectLiteralToJson(expr);
  return { ok: false };
}

// ── top-level const resolution (schema field only — dispatcher directive 1) ────────────────

/** Resolves `name` to the initializer of a same-module TOP-LEVEL `const name = <expr>`
 *  declaration. Returns `undefined` for anything else (imported identifiers, `let`/`var`,
 *  nested/function-scoped declarations) — those stay non-analyzable by design. */
export function resolveTopLevelConstInitializer(sourceFile: ts.SourceFile, name: string): ts.Expression | undefined {
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    if (ts.getCombinedNodeFlags(stmt.declarationList) !== ts.NodeFlags.Const) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) {
        return decl.initializer;
      }
    }
  }
  return undefined;
}

function unwrapTypeWrappers(expr: ts.Expression): ts.Expression {
  let cur = expr;
  for (;;) {
    if (ts.isParenthesizedExpression(cur)) {
      cur = cur.expression;
    } else if (ts.isAsExpression(cur) || ts.isTypeAssertionExpression(cur)) {
      cur = cur.expression;
    } else {
      break;
    }
  }
  return cur;
}

/** Resolves the `schema` field's value expression: a direct object literal, OR an identifier
 *  resolved to a same-module top-level `const` literal initializer (dispatcher directive 1).
 *  Returns the resolved AST node (for line anchoring) alongside the converted JSON value. */
export function resolveSchemaValue(
  sourceFile: ts.SourceFile,
  valueExpr: ts.Expression,
): { ok: true; value: JsonLiteral; node: ts.Expression } | { ok: false } {
  let expr = unwrapTypeWrappers(valueExpr);
  if (ts.isIdentifier(expr)) {
    const resolved = resolveTopLevelConstInitializer(sourceFile, expr.text);
    if (!resolved) return { ok: false };
    expr = unwrapTypeWrappers(resolved);
  }
  const conv = literalToJson(expr);
  if (!conv.ok) return { ok: false };
  return { ok: true, value: conv.value, node: expr };
}

/** Locates the `schema` property's resolved node (for line-accurate schema-pass diagnostics),
 *  without re-validating — callers already know `ctx.manifest.schema` is set. */
export function resolveSchemaNode(sourceFile: ts.SourceFile, argumentNode: ts.ObjectLiteralExpression | undefined): ts.Node | undefined {
  if (!argumentNode) return undefined;
  const prop = getProperty(argumentNode, 'schema');
  if (!prop || !ts.isPropertyAssignment(prop)) return undefined;
  const resolved = resolveSchemaValue(sourceFile, prop.initializer);
  return resolved.ok ? resolved.node : prop.initializer;
}

// ── default-export (`defineApp({...})`) lookup ─────────────────────────────────────────────

export interface DefineAppFound {
  callExpr: ts.CallExpression;
  argument: ts.ObjectLiteralExpression;
}

export type DefineAppLookup =
  | { kind: 'found'; result: DefineAppFound }
  | { kind: 'missing' }
  | { kind: 'duplicated'; nodes: ts.Node[] }
  | { kind: 'malformed'; node: ts.Node };

function isDefaultExportNode(node: ts.Statement): boolean {
  if (ts.isExportAssignment(node) && !node.isExportEquals) return true;
  if (ts.canHaveModifiers(node)) {
    const mods = ts.getModifiers(node);
    if (mods?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) return true;
  }
  return false;
}

export function findDefineAppExport(sourceFile: ts.SourceFile): DefineAppLookup {
  const defaultExports = sourceFile.statements.filter(isDefaultExportNode);
  if (defaultExports.length === 0) return { kind: 'missing' };
  if (defaultExports.length > 1) return { kind: 'duplicated', nodes: defaultExports };

  const only = defaultExports[0];
  if (!ts.isExportAssignment(only)) return { kind: 'malformed', node: only };

  const expr = unwrapTypeWrappers(only.expression);
  if (!ts.isCallExpression(expr) || !ts.isIdentifier(expr.expression) || expr.expression.text !== 'defineApp') {
    return { kind: 'malformed', node: only };
  }
  const arg = expr.arguments[0];
  if (!arg || !ts.isObjectLiteralExpression(arg)) return { kind: 'malformed', node: expr };
  return { kind: 'found', result: { callExpr: expr, argument: arg } };
}

/** Finds a plain (non-computed) property by display name on an object literal. */
export function getProperty(obj: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralElementLike | undefined {
  return obj.properties.find((p) => {
    if (!p.name) return false;
    const n = getLiteralPropertyName(p.name);
    return n === name;
  });
}
