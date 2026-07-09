/**
 * static-check-pipeline — capability declarations ⇄ use, both directions (task 5.2, spec
 * "Capability declarations match capability use, both directions"). Table-driven over
 * `CAPABILITY_EXPORTS` (design D6): a `vc-sdk` capability-backed export used without its
 * capability declared → `undeclared_capability` error (the bridge gate's own kind, P4); a
 * declared capability whose export is never used → `unused_capability` warning. A declared
 * capability with NO row at all (e.g. `diag` — no SDK facade) is always `unused_capability`,
 * since it can never be satisfied by a use.
 *
 * Runs only when `ctx.manifest` is set (manifest-extraction succeeded) — a manifest that
 * failed to extract has already produced its own `manifest_not_static` diagnostic(s).
 */

import ts from 'typescript';
import { CAPABILITY_EXPORTS, Diagnostic } from '../contract';
import { CheckContext, Pass, lineOf, resolvesToImport, rootIdentifierOf } from '../internal/scope';
import { getProperty } from '../internal/manifest';

/** The one module a capability-backed export can come from. A root identifier only counts as
 *  "use" of `row.sdkExport` when it resolves, via lexical scope, to the `vc-sdk` import of that
 *  export — never merely by matching root-identifier text (Finding 1: a local shadow of the
 *  same name, or a source with no `vc-sdk` import of it at all, must NOT count). */
const VC_SDK_SPECIFIER = 'vc-sdk';

/** Locates the string-literal element in the `capabilities` array matching `capability`, for
 *  a line-accurate `unused_capability` anchor. Falls back to the array itself. */
function capabilityLiteralNode(argument: ts.ObjectLiteralExpression | undefined, capability: string): ts.Node | undefined {
  if (!argument) return undefined;
  const prop = getProperty(argument, 'capabilities');
  if (!prop || !ts.isPropertyAssignment(prop) || !ts.isArrayLiteralExpression(prop.initializer)) return prop;
  const el = prop.initializer.elements.find((e) => ts.isStringLiteralLike(e) && e.text === capability);
  return el ?? prop.initializer;
}

export const capabilityDirectionsPass: Pass = (ctx: CheckContext) => {
  const manifest = ctx.manifest;
  if (!manifest) return;
  const { sourceFile } = ctx;

  const declared = new Set(manifest.capabilities);
  const usedFirstNode = new Map<string, ts.Node>(); // sdkExport name -> first usage site

  function visit(node: ts.Node): void {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const root = rootIdentifierOf(node.expression);
      if (root) {
        for (const row of CAPABILITY_EXPORTS) {
          if (usedFirstNode.has(row.sdkExport)) continue;
          if (resolvesToImport(root, ctx, VC_SDK_SPECIFIER, row.sdkExport)) {
            usedFirstNode.set(row.sdkExport, root);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  // Direction 1: declared → export-in-use. Includes capabilities with NO row (always unused).
  for (const capability of manifest.capabilities) {
    const row = CAPABILITY_EXPORTS.find((r) => r.capability === capability);
    const used = row ? usedFirstNode.has(row.sdkExport) : false;
    if (used) continue;
    const node = capabilityLiteralNode(ctx.manifestArgumentNode, capability) ?? sourceFile;
    const { line, column } = lineOf(sourceFile, node);
    const d: Diagnostic = {
      kind: 'unused_capability',
      severity: 'warning',
      line,
      column,
      symbol: capability,
      message: `"${capability}" is declared in capabilities but no matching vc-sdk export is used.`,
      hint: `Remove "${capability}" from the manifest's capabilities array — it is never exercised.`,
    };
    ctx.report(d);
  }

  // Direction 2: export-in-use → declared.
  for (const row of CAPABILITY_EXPORTS) {
    if (!usedFirstNode.has(row.sdkExport) || declared.has(row.capability)) continue;
    const node = usedFirstNode.get(row.sdkExport)!;
    const { line, column } = lineOf(sourceFile, node);
    const corrected = [...manifest.capabilities, row.capability];
    const d: Diagnostic = {
      kind: 'undeclared_capability',
      severity: 'error',
      line,
      column,
      symbol: row.capability,
      message: `"${row.sdkExport}" is used but "${row.capability}" is not declared in capabilities.`,
      hint: `Add "${row.capability}" to the manifest's capabilities array, e.g. capabilities: ${JSON.stringify(corrected)}.`,
    };
    ctx.report(d);
  }
};
