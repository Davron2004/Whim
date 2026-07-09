/**
 * static-check-pipeline — manifest extraction pass (task 5.1, spec "The app manifest is
 * extracted statically, literal-only"). Reads the single default-exported `defineApp({...})`
 * literal into `{name, initial, screens, capabilities, schema}`; any field that is not
 * statically analyzable produces a `manifest_not_static` error. `ctx.manifest` is set ONLY
 * when the four required fields (name/initial/screens/capabilities) all extract cleanly —
 * `schema` stays optional (its own extraction failure is reported but does not block the rest
 * of the manifest, per ExtractedManifest's optional `schema?`).
 *
 * DEVIATION (class A, see chain D report): the spec's prose says a *missing* default
 * `defineApp` export "SHALL produce an error diagnostic", but the due-now acceptance suite
 * (`D §sdk-lint`) checks a source with NO `defineApp` at all and asserts the report carries
 * only a warning, no errors. A source without any default export is therefore treated as
 * "not an app manifest to extract" — silently skipped, no diagnostic, no `ctx.manifest`. A
 * PRESENT-but-malformed or duplicated default export is still flagged.
 */

import ts from 'typescript';
import { Diagnostic } from '../contract';
import { CheckContext, Pass, lineOf } from '../internal/scope';
import { findDefineAppExport, getProperty, literalToJson, resolveSchemaValue } from '../internal/manifest';

function fieldDiag(sourceFile: ts.SourceFile, node: ts.Node, field: string, message: string): Diagnostic {
  const { line, column } = lineOf(sourceFile, node);
  return { kind: 'manifest_not_static', severity: 'error', line, column, symbol: field, message, hint: message };
}

type FieldResult<T> = { ok: true; value: T } | { ok: false };

function extractStringField(
  sourceFile: ts.SourceFile,
  obj: ts.ObjectLiteralExpression,
  field: string,
  errors: Diagnostic[],
): FieldResult<string> {
  const prop = getProperty(obj, field);
  if (!prop || !ts.isPropertyAssignment(prop)) {
    errors.push(fieldDiag(sourceFile, prop ?? obj, field, `Manifest field "${field}" is required and must be a string literal.`));
    return { ok: false };
  }
  const conv = literalToJson(prop.initializer);
  if (!conv.ok || typeof conv.value !== 'string') {
    errors.push(fieldDiag(sourceFile, prop.initializer, field, `Manifest field "${field}" must be a string literal.`));
    return { ok: false };
  }
  return { ok: true, value: conv.value };
}

function extractCapabilitiesField(
  sourceFile: ts.SourceFile,
  obj: ts.ObjectLiteralExpression,
  errors: Diagnostic[],
): FieldResult<string[]> {
  const prop = getProperty(obj, 'capabilities');
  if (!prop || !ts.isPropertyAssignment(prop) || !ts.isArrayLiteralExpression(prop.initializer)) {
    errors.push(
      fieldDiag(sourceFile, prop ?? obj, 'capabilities', 'Manifest field "capabilities" must be a literal array of capability strings.'),
    );
    return { ok: false };
  }
  const values: string[] = [];
  for (const el of prop.initializer.elements) {
    const conv = literalToJson(el);
    if (!conv.ok || typeof conv.value !== 'string') {
      errors.push(
        fieldDiag(sourceFile, el, 'capabilities', 'Manifest field "capabilities" must be a literal array of capability strings.'),
      );
      return { ok: false };
    }
    values.push(conv.value);
  }
  return { ok: true, value: values };
}

function extractScreensField(
  sourceFile: ts.SourceFile,
  obj: ts.ObjectLiteralExpression,
  errors: Diagnostic[],
): FieldResult<Record<string, true>> {
  const prop = getProperty(obj, 'screens');
  if (!prop || !ts.isPropertyAssignment(prop) || !ts.isObjectLiteralExpression(prop.initializer)) {
    errors.push(
      fieldDiag(sourceFile, prop ?? obj, 'screens', 'Manifest field "screens" must be a literal object mapping screen names to components.'),
    );
    return { ok: false };
  }
  const result: Record<string, true> = {};
  for (const el of prop.initializer.properties) {
    if (!el.name || ts.isComputedPropertyName(el.name) || (!ts.isIdentifier(el.name) && !ts.isStringLiteral(el.name))) {
      errors.push(
        fieldDiag(sourceFile, el, 'screens', 'Manifest field "screens" entries must be plain (non-computed, non-spread) properties.'),
      );
      return { ok: false };
    }
    result[el.name.text] = true;
  }
  return { ok: true, value: result };
}

function extractSchemaField(
  sourceFile: ts.SourceFile,
  obj: ts.ObjectLiteralExpression,
  errors: Diagnostic[],
): FieldResult<unknown> {
  const prop = getProperty(obj, 'schema');
  if (!prop) return { ok: false }; // schema is optional — absence is not an error
  if (!ts.isPropertyAssignment(prop)) {
    errors.push(fieldDiag(sourceFile, prop, 'schema', 'Manifest field "schema" must be a literal object (or a same-module top-level const initialized with one).'));
    return { ok: false };
  }
  const resolved = resolveSchemaValue(sourceFile, prop.initializer);
  if (!resolved.ok) {
    errors.push(
      fieldDiag(
        sourceFile,
        prop.initializer,
        'schema',
        'Manifest field "schema" must be a literal object (or a same-module top-level const initialized with one) — imported identifiers, call results, spreads, and reassigned bindings are not statically analyzable.',
      ),
    );
    return { ok: false };
  }
  return { ok: true, value: resolved.value };
}

export const manifestExtractionPass: Pass = (ctx: CheckContext) => {
  const { sourceFile } = ctx;
  const lookup = findDefineAppExport(sourceFile);

  if (lookup.kind === 'missing') return; // see class-A deviation note above
  if (lookup.kind === 'duplicated') {
    ctx.report(fieldDiag(sourceFile, lookup.nodes[1], 'defineApp', 'Only one `export default defineApp({...})` is allowed per source.'));
    return;
  }
  if (lookup.kind === 'malformed') {
    ctx.report(fieldDiag(sourceFile, lookup.node, 'defineApp', 'The default export must be a direct `defineApp({...})` call with an object-literal argument.'));
    return;
  }

  const { argument } = lookup.result;
  ctx.manifestArgumentNode = argument;

  const errors: Diagnostic[] = [];
  const name = extractStringField(sourceFile, argument, 'name', errors);
  const initial = extractStringField(sourceFile, argument, 'initial', errors);
  const screens = extractScreensField(sourceFile, argument, errors);
  const capabilities = extractCapabilitiesField(sourceFile, argument, errors);
  const schema = extractSchemaField(sourceFile, argument, errors);

  for (const e of errors) ctx.report(e);

  if (name.ok && initial.ok && screens.ok && capabilities.ok) {
    ctx.manifest = {
      name: name.value,
      initial: initial.value,
      screens: screens.value,
      capabilities: capabilities.value,
      ...(schema.ok ? { schema: schema.value } : {}),
    };
  }
};
