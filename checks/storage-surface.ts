/**
 * static-check-pipeline — the shared storage-surface scanner (generation-pipeline req "The
 * storage-surface instruction and the drift check read one scanner").
 *
 * ONE extractor, two consumers: the storage locations an edit turn renders into the prompt and
 * the baseline the continuity pass compares a candidate against are both this function's
 * output. Nothing downstream may re-derive storage names by a second scan or a hand-kept list.
 *
 * Syntactic and binding-resolved, deliberately narrow: a location is collected only from a
 * `<storage>.kv.<method>(...)` / `<storage>.records.<method>(...)` call whose root lexically
 * resolves to the `vc-sdk` `storage` import (the T8 rule — never token matching), and only from
 * its FIRST argument, which is the key (kv) or the collection (records) in every method of both
 * facades (`src/sdk/index.tsx`'s `storage`).
 *
 * KNOWN LIMIT (asserted in the acceptance suite, not a bug to fix silently): a facade held in a
 * local alias — `const kv = storage.kv; kv.get('total')` — is NOT collected. Aliasing would need
 * the value-flow analysis the checker deliberately does not do. The failure mode is a missed
 * guarantee (an uncollected read), never a false accusation: continuity can only fire on
 * locations the scanner did collect.
 */

import ts from 'typescript';
import { parseSource } from './internal/parse';
import { CheckContext, buildContext, lineOf, resolvesToImport } from './internal/scope';

const VC_SDK_SPECIFIER = 'vc-sdk';

/** The two storage facades a location can belong to. Continuity is judged per facade. */
export type StorageFacade = 'kv' | 'records';

/** One storage location the source names with a string literal. */
export interface StorageReference {
  /** The literal kv key or record-collection display name, verbatim. */
  name: string;
  /** The facade method it was passed to, verbatim. METHOD-AGNOSTIC: whatever name follows the
   *  facade is recorded, so today's roster (`kv.get`/`set`/`remove`,
   *  `records.append`/`list`/`update`/`remove`) needs no update here when the SDK grows one. */
  method: string;
  /** 1-based line of the literal in the scanned source. */
  line: number;
  /** 1-based column of the literal in the scanned source. */
  column: number;
}

/** A facade call whose first argument is not a string literal, so the location it names cannot
 *  be established. Anchored at the argument — the call site's most specific position. */
export interface DynamicStorageSite {
  facade: StorageFacade;
  method: string;
  line: number;
  column: number;
}

/**
 * What a source names through the storage facade. `kvKeys` and `collections` are DEDUPLICATED
 * by name — first occurrence wins, source order preserved — because they are sets of locations,
 * and the anchor is the first place the source names each one. `dynamic` is NOT deduplicated:
 * every non-literal argument is its own call site, and its own warning.
 */
export interface StorageSurface {
  kvKeys: readonly StorageReference[];
  collections: readonly StorageReference[];
  dynamic: readonly DynamicStorageSite[];
}

/** True when `expr` denotes the `vc-sdk` `storage` export — the named import itself, or
 *  `<ns>.storage` for a namespace import. A local shadow of the name resolves to neither. */
function isStorageExport(expr: ts.Expression, ctx: CheckContext): boolean {
  if (ts.isIdentifier(expr)) return resolvesToImport(expr, ctx, VC_SDK_SPECIFIER, 'storage');
  return (
    ts.isPropertyAccessExpression(expr) &&
    expr.name.text === 'storage' &&
    ts.isIdentifier(expr.expression) &&
    resolvesToImport(expr.expression, ctx, VC_SDK_SPECIFIER, '*')
  );
}

/** Classifies a call's callee as a storage-facade method, or `undefined` for everything else. */
function facadeCallOf(callee: ts.Expression, ctx: CheckContext): { facade: StorageFacade; method: string } | undefined {
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  const facadeAccess = callee.expression;
  if (!ts.isPropertyAccessExpression(facadeAccess)) return undefined;
  const facade = facadeAccess.name.text;
  if (facade !== 'kv' && facade !== 'records') return undefined;
  if (!isStorageExport(facadeAccess.expression, ctx)) return undefined;
  return { facade, method: callee.name.text };
}

/** Mutable accumulator for one scan; `seen` keeps `kvKeys`/`collections` deduplicated. */
interface SurfaceAccumulator {
  kvKeys: StorageReference[];
  collections: StorageReference[];
  dynamic: DynamicStorageSite[];
  seen: Record<StorageFacade, Set<string>>;
}

/** Records what a single node contributes to the surface. A non-facade node contributes
 *  nothing; so does a facade call with no arguments — it names no location, and there is no
 *  argument that could have been a literal. */
function collectFrom(node: ts.Node, ctx: CheckContext, acc: SurfaceAccumulator): void {
  if (!ts.isCallExpression(node) || node.arguments.length === 0) return;
  const call = facadeCallOf(node.expression, ctx);
  if (!call) return;

  const arg = node.arguments[0];
  const at = lineOf(ctx.sourceFile, arg);
  if (!ts.isStringLiteralLike(arg)) {
    acc.dynamic.push({ facade: call.facade, method: call.method, ...at });
    return;
  }
  if (acc.seen[call.facade].has(arg.text)) return;
  acc.seen[call.facade].add(arg.text);
  const bucket = call.facade === 'kv' ? acc.kvKeys : acc.collections;
  bucket.push({ name: arg.text, method: call.method, ...at });
}

/**
 * Scans `source` for every storage location it names. Pure and total: a source that does not
 * parse yields whatever the recovered tree contains (the parse gate, not this scanner, reports
 * a syntax error), and a source with no storage use yields three empty lists.
 */
export function scanStorageSurface(source: string): StorageSurface {
  const { sourceFile } = parseSource(source);
  // The scanner never diagnoses — it reports only what it found. The context exists solely so
  // `resolvesToImport` can do lexical binding resolution, hence the discarding report sink.
  const ctx = buildContext(source, sourceFile, () => {}, undefined);
  const acc: SurfaceAccumulator = {
    kvKeys: [],
    collections: [],
    dynamic: [],
    seen: { kv: new Set(), records: new Set() },
  };

  function visit(node: ts.Node): void {
    collectFrom(node, ctx, acc);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  return { kvKeys: acc.kvKeys, collections: acc.collections, dynamic: acc.dynamic };
}
