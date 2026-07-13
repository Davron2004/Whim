/**
 * static-check-pipeline — shared checker plumbing (task 4.1, `handoff/checker-internals.md`).
 *
 * `CheckContext`/`Pass` are the seam every pass (Chain C's own, and Chain D's later ones)
 * plugs into. `resolveBinding` is the T8 walk's core: lexical **binding** resolution, never
 * token matching (decisions #37, T8) — a local declaration always wins over a same-named
 * global, and taint follows lexical assignment (`const g = globalThis; const h = g;`).
 */

import ts from 'typescript';
import { Diagnostic, ExtractedManifest, FORBIDDEN_DIRECT_NAMES, GLOBAL_ROOTS } from '../contract';
import type { AppliedSchema } from '../../src/host/storage-engine/schema';

export interface CheckContext {
  source: string;
  sourceFile: ts.SourceFile;
  appliedSchema?: AppliedSchema;
  report(d: Diagnostic): void;
  /** Set by the manifest-extraction pass (task 5.1) when all required fields extract cleanly;
   *  later passes (capabilities/screens/schema) read this instead of re-parsing `defineApp`. */
  manifest?: ExtractedManifest;
  /** Set by the manifest-extraction pass whenever a `defineApp({...})` argument object was
   *  found, even if some fields failed to extract — lets later passes locate manifest
   *  sub-nodes (e.g. the `schema` property) for line-accurate diagnostics. */
  manifestArgumentNode?: ts.ObjectLiteralExpression;
}

/** Every pass is a pure function over the shared context; it emits via `ctx.report`. */
export type Pass = (ctx: CheckContext) => void;

/**
 * `'global'`    — the identifier resolves to no local declaration (an ambient/global name).
 * `'local'`     — resolves to an honest local declaration (param/const/let/var/function/...)
 *                 that was never assigned from a forbidden root — never flagged (task 4.3).
 * `'tainted'`   — resolves to a local declaration whose value chain traces back (via direct
 *                 `const x = <identifier>` assignment, transitively) to a forbidden global
 *                 root or name.
 */
export type Binding = 'global' | 'local' | 'tainted';

/**
 * Identifies a lexical binding that was introduced by an `import` declaration (task capfix-1 —
 * `capabilities.ts`'s shadow guard). `moduleSpecifier` is the import's source text verbatim
 * (e.g. `'vc-sdk'`); `importedName` is the name exported BY THE MODULE (before any local
 * alias) — `'default'` for a default import, `'*'` for a namespace import, or the named
 * specifier's `propertyName ?? name` text otherwise.
 */
export interface ImportBindingInfo {
  moduleSpecifier: string;
  importedName: string;
}

// ── binding-map construction (one walk per sourceFile, cached) ─────────────────────────────

interface ScopeEntry {
  tainted: boolean;
  /** Set only when this declaration is the import binding itself (not a plain local). */
  importInfo?: ImportBindingInfo;
}

type ScopeFrame = Map<string, ScopeEntry>; // declared name -> entry

const TAINT_SOURCE_NAMES: ReadonlySet<string> = new Set([...GLOBAL_ROOTS, ...FORBIDDEN_DIRECT_NAMES]);
const NAMED_BINDING_DECLARATION_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.VariableDeclaration,
  ts.SyntaxKind.Parameter,
  ts.SyntaxKind.BindingElement,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.ClassExpression,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.PropertyAssignment,
  ts.SyntaxKind.ShorthandPropertyAssignment,
  ts.SyntaxKind.PropertySignature,
  ts.SyntaxKind.MethodSignature,
  ts.SyntaxKind.EnumMember,
  ts.SyntaxKind.TypeParameter,
  ts.SyntaxKind.JsxAttribute,
]);
const BLOCK_SCOPED_VARIABLE_FLAGS: ReadonlySet<ts.NodeFlags> = new Set([
  ts.NodeFlags.Let,
  ts.NodeFlags.Const,
  ts.NodeFlags.Using,
  ts.NodeFlags.AwaitUsing,
]);

function hasName(node: ts.Node, id: ts.Identifier): boolean {
  return (node as ts.Node & { name?: ts.Node }).name === id;
}

function isBindingDeclarationName(id: ts.Identifier): boolean {
  const p = id.parent;
  if (!p) return false;
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return true;
  if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return p.label === id;
  return NAMED_BINDING_DECLARATION_KINDS.has(p.kind) && hasName(p, id);
}

function isPropertyAccessOrTypeName(id: ts.Identifier): boolean {
  const p = id.parent;
  if (!p) return false;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return true;
  if (ts.isQualifiedName(p) && p.right === id) return true;
  if (ts.isTypeReferenceNode(p)) return true;
  if (ts.isTypeQueryNode(p)) return true;
  return false;
}

/** An identifier is a "read" (a value reference subject to scope resolution) unless it is a
 *  declaration's own name, a property-access/property-key name, or a type-position name. */
function isReadIdentifier(id: ts.Identifier): boolean {
  return !isBindingDeclarationName(id) && !isPropertyAccessOrTypeName(id);
}

function declareBindingPattern(name: ts.BindingName, declare: (n: string, tainted: boolean) => void): void {
  if (ts.isIdentifier(name)) {
    declare(name.text, false);
    return;
  }
  for (const el of name.elements) {
    if (ts.isOmittedExpression(el)) continue;
    declareBindingPattern(el.name, declare);
  }
}

function isScopeBoundary(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessor(node) ||
    ts.isSetAccessor(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isBlock(node) ||
    ts.isCatchClause(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node)
  );
}

/** Walks up from an import-clause/specifier/namespace-import node to its `ImportDeclaration`,
 *  for the module-specifier text. `undefined` only if the AST shape is unexpected. */
function enclosingImportDeclaration(node: ts.Node): ts.ImportDeclaration | undefined {
  let cur: ts.Node | undefined = node;
  while (cur && !ts.isImportDeclaration(cur)) cur = cur.parent;
  return cur;
}

/** Computes the `ImportBindingInfo` for an import-clause/specifier/namespace-import `name`
 *  node (default import, namespace import, or a named `ImportSpecifier`), given its
 *  `moduleSpecifier` text is a plain string literal (non-literal specifiers are the
 *  `import-allowlist` pass's concern, not this walker's — this returns `undefined` for those,
 *  which is safe: no `ImportBindingInfo` means "cannot be confirmed as this import"). */
function importBindingInfoFor(node: ts.ImportClause | ts.ImportSpecifier | ts.NamespaceImport): ImportBindingInfo | undefined {
  const decl = enclosingImportDeclaration(node);
  if (!decl || !ts.isStringLiteralLike(decl.moduleSpecifier)) return undefined;
  const moduleSpecifier = decl.moduleSpecifier.text;
  if (ts.isImportSpecifier(node)) {
    return { moduleSpecifier, importedName: (node.propertyName ?? node.name).text };
  }
  if (ts.isNamespaceImport(node)) {
    return { moduleSpecifier, importedName: '*' };
  }
  return { moduleSpecifier, importedName: 'default' }; // ImportClause default-import name
}

function buildBindingMap(sourceFile: ts.SourceFile): { bindingMap: Map<ts.Node, Binding>; importBindingMap: Map<ts.Node, ImportBindingInfo> } {
  const result = new Map<ts.Node, Binding>();
  const importResult = new Map<ts.Node, ImportBindingInfo>();
  const moduleScope: ScopeFrame = new Map();
  const scopes: ScopeFrame[] = [moduleScope];
  const scopeForBoundary = new Map<ts.Node, ScopeFrame>();
  const declarationScope = new Map<ts.VariableDeclaration, ScopeFrame>();
  const functionOrModuleScopes = new Set<ScopeFrame>([moduleScope]);

  function lookup(name: string): ScopeEntry | undefined {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const frame = scopes[i];
      if (frame.has(name)) return frame.get(name);
    }
    return undefined;
  }

  function declareIn(scope: ScopeFrame, name: string, importInfo?: ImportBindingInfo): void {
    const existing = scope.get(name);
    if (!existing) {
      scope.set(name, { tainted: false, importInfo });
      return;
    }
    // Duplicate declarations are diagnosed elsewhere. For binding resolution, any plain
    // lexical declaration means the name cannot be proven to resolve to an import.
    if (!importInfo || !existing.importInfo) scope.set(name, { tainted: false });
  }

  function declarePatternIn(scope: ScopeFrame, name: ts.BindingName): void {
    declareBindingPattern(name, (bindingName) => declareIn(scope, bindingName));
  }

  function nearestFunctionOrModuleScope(): ScopeFrame {
    for (let i = scopes.length - 1; i >= 0; i--) {
      if (functionOrModuleScopes.has(scopes[i])) return scopes[i];
    }
    return moduleScope;
  }

  function isBlockScopedVariable(node: ts.VariableDeclaration): boolean {
    return ts.isVariableDeclarationList(node.parent) && BLOCK_SCOPED_VARIABLE_FLAGS.has(node.parent.flags);
  }

  function predeclareNamedDeclaration(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name) declareIn(scopes.at(-1)!, node.name.text);
    if (ts.isClassDeclaration(node) && node.name) declareIn(scopes.at(-1)!, node.name.text);
  }

  function predeclareScopeBoundary(node: ts.Node): boolean {
    if (!isScopeBoundary(node)) return false;
    const scope: ScopeFrame = new Map();
    scopeForBoundary.set(node, scope);
    scopes.push(scope);
    if (ts.isFunctionLike(node)) {
      functionOrModuleScopes.add(scope);
      if (ts.isFunctionExpression(node) && node.name) declareIn(scope, node.name.text);
      for (const parameter of node.parameters) declarePatternIn(scope, parameter.name);
    }
    if (ts.isCatchClause(node) && node.variableDeclaration) {
      declarePatternIn(scope, node.variableDeclaration.name);
    }
    ts.forEachChild(node, predeclare);
    scopes.pop();
    return true;
  }

  function predeclareVariable(node: ts.Node): void {
    if (!ts.isVariableDeclaration(node) || ts.isCatchClause(node.parent)) return;
    const owner = isBlockScopedVariable(node) ? scopes.at(-1)! : nearestFunctionOrModuleScope();
    declarationScope.set(node, owner);
    declarePatternIn(owner, node.name);
  }

  function predeclareImport(node: ts.Node): void {
    if (!ts.isImportSpecifier(node) && !ts.isImportClause(node) && !ts.isNamespaceImport(node)) return;
    const name = 'name' in node ? node.name : undefined;
    if (name && ts.isIdentifier(name)) declareIn(scopes.at(-1)!, name.text, importBindingInfoFor(node));
  }

  /** First pass: create every lexical scope and predeclare all of its bindings before any
   *  reads are classified. `var` belongs to the nearest function/module scope even when its
   *  declaration is nested inside a block; let/const belong to the active lexical owner. */
  function predeclare(node: ts.Node): void {
    predeclareNamedDeclaration(node);
    if (predeclareScopeBoundary(node)) return;
    predeclareVariable(node);
    predeclareImport(node);
    ts.forEachChild(node, predeclare);
  }

  predeclare(sourceFile);
  scopes.length = 1;

  function initializerTaint(init: ts.Expression | undefined): boolean {
    let expr = init;
    while (expr && ts.isParenthesizedExpression(expr)) expr = expr.expression;
    if (!expr || !ts.isIdentifier(expr)) return false;
    const local = lookup(expr.text);
    if (local !== undefined) return local.tainted;
    return TAINT_SOURCE_NAMES.has(expr.text);
  }

  function visitVariableDeclaration(node: ts.VariableDeclaration): void {
    if (node.initializer) visit(node.initializer);
    const owner = declarationScope.get(node);
    if (owner && ts.isIdentifier(node.name)) {
      owner.set(node.name.text, { tainted: initializerTaint(node.initializer) });
    }
  }

  function visitScopedNode(node: ts.Node): void {
    scopes.push(scopeForBoundary.get(node)!);
    ts.forEachChild(node, visit);
    scopes.pop();
  }

  function bindingFor(local: ScopeEntry | undefined): Binding {
    if (local === undefined) return 'global';
    if (local.tainted) return 'tainted';
    return 'local';
  }

  function visitIdentifier(node: ts.Identifier): void {
    if (!isReadIdentifier(node)) return;
    const local = lookup(node.text);
    result.set(node, bindingFor(local));
    if (local?.importInfo) importResult.set(node, local.importInfo);
  }

  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node)) return visitVariableDeclaration(node);
    if (isScopeBoundary(node)) return visitScopedNode(node);
    if (ts.isIdentifier(node)) return visitIdentifier(node);
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { bindingMap: result, importBindingMap: importResult };
}

const bindingMapCache = new WeakMap<ts.SourceFile, { bindingMap: Map<ts.Node, Binding>; importBindingMap: Map<ts.Node, ImportBindingInfo> }>();

function bindingMapsFor(sourceFile: ts.SourceFile): { bindingMap: Map<ts.Node, Binding>; importBindingMap: Map<ts.Node, ImportBindingInfo> } {
  let maps = bindingMapCache.get(sourceFile);
  if (!maps) {
    maps = buildBindingMap(sourceFile);
    bindingMapCache.set(sourceFile, maps);
  }
  return maps;
}

/**
 * Resolves an identifier's binding via lexical scope, not token matching. Only meaningful for
 * `ts.Identifier` nodes in a value-read position from `ctx.sourceFile`'s own tree (property
 * names, type names, and declaration names are not classified — they return `'local'`).
 */
export function resolveBinding(node: ts.Node, ctx: CheckContext): Binding {
  return bindingMapsFor(ctx.sourceFile).bindingMap.get(node) ?? 'local';
}

/**
 * Resolves an identifier's `ImportBindingInfo` when — and only when — its nearest lexical
 * declaration IS an import specifier (not a plain local/param/function/class declaration, and
 * not shadowed by one). `undefined` covers both "resolves to a global" and "resolves to a
 * non-import local that shadows an import of the same name" (task capfix-1 — this is the
 * distinction `Binding` alone cannot make, since an unshadowed import and a shadowing local
 * both classify as `'local'`).
 */
export function resolveImportBinding(node: ts.Node, ctx: CheckContext): ImportBindingInfo | undefined {
  return bindingMapsFor(ctx.sourceFile).importBindingMap.get(node);
}

/** Convenience wrapper: does this identifier resolve to the import of `importedName` from
 *  `moduleSpecifier` (verbatim module-specifier text), as opposed to a shadowing local or an
 *  unrelated global? */
export function resolvesToImport(node: ts.Node, ctx: CheckContext, moduleSpecifier: string, importedName: string): boolean {
  const info = resolveImportBinding(node, ctx);
  return info?.moduleSpecifier === moduleSpecifier && info?.importedName === importedName;
}

/** Walks down through parens/property/element access to the leftmost identifier root, e.g.
 *  `top.frames.fetch` → `top`. Passes use this to classify a member-access chain's origin. */
export function rootIdentifierOf(expr: ts.Expression): ts.Identifier | undefined {
  let cur: ts.Expression = expr;
  for (;;) {
    if (ts.isParenthesizedExpression(cur)) {
      cur = cur.expression;
    } else if (ts.isPropertyAccessExpression(cur)) {
      cur = cur.expression;
    } else if (ts.isElementAccessExpression(cur)) {
      cur = cur.expression;
    } else if (ts.isNonNullExpression(cur) || ts.isAsExpression(cur)) {
      cur = cur.expression;
    } else {
      break;
    }
  }
  return ts.isIdentifier(cur) ? cur : undefined;
}

/** 1-based line/column for a node's start position, shared by every pass's diagnostic anchor. */
export function lineOf(sourceFile: ts.SourceFile, node: ts.Node): { line: number; column: number } {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: line + 1, column: character + 1 };
}

export function buildContext(
  source: string,
  sourceFile: ts.SourceFile,
  report: (d: Diagnostic) => void,
  appliedSchema: AppliedSchema | undefined,
): CheckContext {
  return { source, sourceFile, appliedSchema, report };
}
