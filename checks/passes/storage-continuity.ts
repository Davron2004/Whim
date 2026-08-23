/**
 * static-check-pipeline — storage continuity (static-checks req "An edit candidate keeps
 * reading where the data already is", design D3/D4/D5).
 *
 * Runs only when the caller supplied `ctx.previousSurface` — the surface of the source this
 * candidate replaces. A first generation has nothing to be continuous with, so the pass is
 * silent, including its warning.
 *
 * The rule is SUPERSET, never equality (D4): every kv key and every record collection the
 * previous source named by string literal must still be named by the candidate; anything the
 * candidate adds is free. A location the candidate abandons is where the user's rows already
 * are, so it is an error, not a warning.
 *
 * Non-literal arguments (D5): a computed key makes the absence unprovable in BOTH directions —
 * the harness can neither confirm nor refute that the candidate still reads a given location
 * through it. So each such call site draws a `storage_surface_dynamic` WARNING (never silence,
 * which is the defect this change exists to fix) and suppresses `storage_surface_drift` for
 * that facade (`kv` or `records`) alone — a computed record collection says nothing about the
 * candidate's kv reads.
 *
 * ONE scanner, two consumers (D3): the candidate's surface comes from `scanStorageSurface`, the
 * same function that produced `ctx.previousSurface` and the prompt's storage-location
 * instruction. Nothing here re-derives storage names. Its KNOWN LIMIT (an aliased facade is not
 * collected) is safe in this direction: an uncollected read of the PREVIOUS source is a
 * location this pass never demands, and continuity can only fire on collected locations.
 */

import { Diagnostic } from '../contract';
import { CheckContext, Pass, lineOf } from '../internal/scope';
import { scanStorageSurface, StorageFacade, StorageReference } from '../storage-surface';

interface FacadeRow {
  facade: StorageFacade;
  /** How the hint names this facade's locations to the model. */
  noun: string;
  /** The `storage.<facade>` call shape the hint steers back to. */
  callShape: string;
}

const FACADES: readonly FacadeRow[] = [
  { facade: 'kv', noun: 'kv key', callShape: 'storage.kv' },
  { facade: 'records', noun: 'record collection', callShape: 'storage.records' },
];

function driftDiagnostic(row: FacadeRow, missing: StorageReference, anchor: { line: number; column: number }): Diagnostic {
  const hint = `Keep reading the ${row.noun} "${missing.name}" — the user's existing data lives there; a ${row.callShape} call under a different name starts from empty.`;
  return {
    kind: 'storage_surface_drift',
    severity: 'error',
    line: anchor.line,
    column: anchor.column,
    symbol: missing.name,
    message: `The previous version read the ${row.noun} "${missing.name}"; this one does not.`,
    hint,
  };
}

function dynamicDiagnostic(facade: StorageFacade, method: string, line: number, column: number): Diagnostic {
  const hint = `Pass a string literal to \`storage.${facade}.${method}\` so the ${facade === 'kv' ? 'key' : 'collection'} it reads can be checked against the user's existing data.`;
  return {
    kind: 'storage_surface_dynamic',
    severity: 'warning',
    line,
    column,
    symbol: `storage.${facade}.${method}`,
    message: `The argument to \`storage.${facade}.${method}\` is not a string literal, so the location it names cannot be established.`,
    hint,
  };
}

function locationsOf(surface: { kvKeys: readonly StorageReference[]; collections: readonly StorageReference[] }, facade: StorageFacade): readonly StorageReference[] {
  return facade === 'kv' ? surface.kvKeys : surface.collections;
}

export const storageContinuityPass: Pass = (ctx: CheckContext) => {
  const previous = ctx.previousSurface;
  if (!previous) return;

  const candidate = scanStorageSurface(ctx.source);

  const suppressed = new Set<StorageFacade>();
  for (const site of candidate.dynamic) {
    suppressed.add(site.facade);
    ctx.report(dynamicDiagnostic(site.facade, site.method, site.line, site.column));
  }

  // An absence has no node of its own: the subject is the whole candidate, so drift anchors at
  // the source's first token — the `?? sourceFile` idiom the capability pass already uses for
  // its declared-but-unused direction.
  const anchor = lineOf(ctx.sourceFile, ctx.sourceFile);

  for (const row of FACADES) {
    if (suppressed.has(row.facade)) continue;
    const kept = new Set(locationsOf(candidate, row.facade).map((r) => r.name));
    for (const missing of locationsOf(previous, row.facade)) {
      if (kept.has(missing.name)) continue;
      ctx.report(driftDiagnostic(row, missing, anchor));
    }
  }
};
