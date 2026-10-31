/**
 * static-check-pipeline — manifest extraction pass (task 5.1, spec "The app manifest is
 * extracted statically, literal-only"). Reads the single default-exported `defineApp({...})`
 * literal into `{name, initial, screens, capabilities, schema, tileColor, tint, icon}`; any REQUIRED field that is not
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
import { TINT_NAMES, type TintName } from '../../src/design/tokens';
import { TINT_ALIASES, isTintName } from '../../src/design/tints';
import { FALLBACK_ICON, resolveGlyph, type GlyphName } from '../../src/design/icons/names';
import { Diagnostic, type ExtractedManifest, type TileDiagnosticKind } from '../contract';
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

/**
 * `tileColor` is legacy (deprecated by `tint`), optional AND non-blocking: an absent or
 * non-string-literal declaration extracts nothing and raises no diagnostic. Only the literal value
 * is lifted here, unvalidated — the host maps it to the nearest tint where it consumes it.
 */
function extractTileColorField(obj: ts.ObjectLiteralExpression): string | undefined {
  const prop = getProperty(obj, 'tileColor');
  if (!prop || !ts.isPropertyAssignment(prop)) return undefined;
  const conv = literalToJson(prop.initializer);
  return conv.ok && typeof conv.value === 'string' ? conv.value : undefined;
}

// ── Tile identity: `tint` and `icon` (design-system-v1 D5) ─────────────────────────────────
// Both are optional and NEVER an error: every alias or fallback applied is a warning diagnostic,
// and the server's check stage keeps those out of the repair loop (`TILE_DIAGNOSTIC_KINDS`).

const MAX_RANKED_TINTS = 3;

function tileDiag(sourceFile: ts.SourceFile, node: ts.Node, kind: TileDiagnosticKind, field: 'tint' | 'icon', message: string, hint: string): Diagnostic {
  const { line, column } = lineOf(sourceFile, node);
  return { kind, severity: 'warning', line, column, symbol: field, message, hint };
}

const TINT_HINT = `Name one to three of the ten tints, most fitting first: ${TINT_NAMES.join(', ')}.`;

/** One declared tint entry → its tint, or `undefined` (dropped) with the warning it earned. */
function resolveTintEntry(sourceFile: ts.SourceFile, node: ts.Expression, warnings: Diagnostic[]): TintName | undefined {
  const conv = literalToJson(node);
  if (!conv.ok || typeof conv.value !== 'string') {
    warnings.push(tileDiag(sourceFile, node, 'tint_fallback', 'tint', 'A tint must be a string literal; this one is ignored.', TINT_HINT));
    return undefined;
  }
  const key = conv.value.trim().toLowerCase();
  if (isTintName(key)) return key;
  if (Object.prototype.hasOwnProperty.call(TINT_ALIASES, key)) {
    const alias = TINT_ALIASES[key];
    warnings.push(tileDiag(sourceFile, node, 'tint_alias', 'tint', `Tint "${conv.value}" is not one of the ten; it is drawn as "${alias}".`, TINT_HINT));
    return alias;
  }
  warnings.push(tileDiag(sourceFile, node, 'tint_fallback', 'tint', `Tint "${conv.value}" is not one of the ten; it is ignored.`, TINT_HINT));
  return undefined;
}

/** `tint: 'rose'` or `tint: ['rose', 'stone']` → the resolved ranked list (deduped, at most
 *  three), or `undefined` when none resolved. */
function extractTintField(sourceFile: ts.SourceFile, obj: ts.ObjectLiteralExpression, warnings: Diagnostic[]): TintName[] | undefined {
  const prop = getProperty(obj, 'tint');
  if (!prop) return undefined;
  if (!ts.isPropertyAssignment(prop)) {
    warnings.push(tileDiag(sourceFile, prop, 'tint_fallback', 'tint', 'The tint must be a string literal or a literal list of them; it is ignored.', TINT_HINT));
    return undefined;
  }
  const entries = ts.isArrayLiteralExpression(prop.initializer) ? [...prop.initializer.elements] : [prop.initializer];
  const ranked: TintName[] = [];
  for (const entry of entries) {
    const tint = resolveTintEntry(sourceFile, entry, warnings);
    if (tint !== undefined && !ranked.includes(tint)) ranked.push(tint);
  }
  return ranked.length > 0 ? ranked.slice(0, MAX_RANKED_TINTS) : undefined;
}

/** `icon: 'coffee'` → the glyph it resolves to (`resolveGlyph`: the glyph set, never chrome). */
function extractIconField(
  sourceFile: ts.SourceFile,
  obj: ts.ObjectLiteralExpression,
  appName: string | undefined,
  warnings: Diagnostic[],
): GlyphName | typeof FALLBACK_ICON | undefined {
  const prop = getProperty(obj, 'icon');
  if (!prop) return undefined;
  const conv = ts.isPropertyAssignment(prop) ? literalToJson(prop.initializer) : undefined;
  if (!ts.isPropertyAssignment(prop) || !conv?.ok || typeof conv.value !== 'string') {
    warnings.push(tileDiag(sourceFile, prop, 'icon_fallback', 'icon', 'The icon must be a string literal; it is ignored.', 'Name one glyph from the glyph set, for example "timer".'));
    return undefined;
  }
  const resolved = resolveGlyph(conv.value, appName);
  if (resolved.diagnostic !== undefined) {
    const { kind, message } = resolved.diagnostic;
    warnings.push(tileDiag(sourceFile, prop.initializer, kind, 'icon', message, `Name one glyph from the glyph set, for example "${resolved.name === FALLBACK_ICON ? 'timer' : resolved.name}".`));
  }
  return resolved.name;
}

/** The resolved tile identity, only the fields that resolved to something. */
function extractTileFields(
  sourceFile: ts.SourceFile,
  obj: ts.ObjectLiteralExpression,
  appName: string | undefined,
  warnings: Diagnostic[],
): Pick<ExtractedManifest, 'tint' | 'icon'> {
  const tint = extractTintField(sourceFile, obj, warnings);
  const icon = extractIconField(sourceFile, obj, appName, warnings);
  return { ...(tint !== undefined ? { tint } : {}), ...(icon !== undefined ? { icon } : {}) };
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
  const tileColor = extractTileColorField(argument);
  const warnings: Diagnostic[] = [];
  const tile = extractTileFields(sourceFile, argument, name.ok ? name.value : undefined, warnings);

  for (const e of errors) ctx.report(e);
  for (const w of warnings) ctx.report(w);

  if (name.ok && initial.ok && screens.ok && capabilities.ok) {
    ctx.manifest = {
      name: name.value,
      initial: initial.value,
      screens: screens.value,
      capabilities: capabilities.value,
      ...(schema.ok ? { schema: schema.value } : {}),
      ...(tileColor !== undefined ? { tileColor } : {}),
      ...tile,
    };
  }
};
