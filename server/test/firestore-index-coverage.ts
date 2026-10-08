/**
 * Which composite indexes the Firestore stores' queries need, derived from the queries themselves
 * (durable-server-stores task 4.4). The emulator serves every query without an index — its
 * `--require_indexes` flag exists only in Datastore mode — so a missing composite index would first
 * fail in production. Instead, `recordQueryShapes` records the structured query of every query the
 * client sends while the conformance cases run, and `uncoveredShapes` lists the ones that need a
 * composite index `deploy/firestore/indexes.json` does not declare.
 *
 * The rule (Firestore's index model): equality filters alone, or filters and ordering on one field,
 * are served by the automatic single-field indexes. Equality filters beside a range or an ordering,
 * or ranges and orderings on more than one field, need a composite index: the equality fields (in
 * any order), then the ordered fields with their directions.
 */
import { Query } from '@google-cloud/firestore';

type Direction = 'ASCENDING' | 'DESCENDING';

/** What one query asks of an index. */
export interface QueryShape {
  readonly collection: string;
  readonly equality: readonly string[];
  readonly ordered: readonly { readonly field: string; readonly direction: Direction }[];
  /** Set when the query uses an operator this checker does not model (array or OR filters). */
  readonly unsupported?: string;
}

/** One `indexes` entry of a Firebase `firestore.indexes.json` file. */
export interface IndexEntry {
  readonly collectionGroup: string;
  readonly queryScope: string;
  readonly fields: readonly { readonly fieldPath: string; readonly order?: Direction; readonly arrayConfig?: string }[];
}

interface FieldRef {
  fieldPath: string;
}

interface FilterProto {
  fieldFilter?: { field: FieldRef; op: string };
  unaryFilter?: { field: FieldRef; op: string };
  compositeFilter?: { op: string; filters: FilterProto[] };
}

interface StructuredQuery {
  from?: { collectionId?: string; allDescendants?: boolean }[];
  where?: FilterProto;
  orderBy?: { field: FieldRef; direction?: Direction }[];
}

const EQUALITY_OPS = new Set(['EQUAL', 'IN', 'IS_NULL', 'IS_NAN']);
const RANGE_OPS = new Set(['LESS_THAN', 'LESS_THAN_OR_EQUAL', 'GREATER_THAN', 'GREATER_THAN_OR_EQUAL', 'NOT_EQUAL', 'NOT_IN', 'IS_NOT_NULL', 'IS_NOT_NAN']);

function shapeOf(query: StructuredQuery): QueryShape {
  const from = query.from?.[0];
  const collection = from?.collectionId ?? '';
  const equality = new Set<string>();
  const ranges: string[] = [];
  let unsupported: string | undefined;
  if (from?.allDescendants) unsupported = 'collection-group query';
  const visit = (filter: FilterProto): void => {
    if (filter.compositeFilter) {
      if (filter.compositeFilter.op !== 'AND') unsupported = `${filter.compositeFilter.op} filter`;
      filter.compositeFilter.filters.forEach(visit);
      return;
    }
    const leaf = filter.fieldFilter ?? filter.unaryFilter;
    if (!leaf) return;
    if (EQUALITY_OPS.has(leaf.op)) equality.add(leaf.field.fieldPath);
    else if (RANGE_OPS.has(leaf.op)) ranges.push(leaf.field.fieldPath);
    else unsupported = `${leaf.op} on ${leaf.field.fieldPath}`;
  };
  if (query.where) visit(query.where);
  const ordered: { field: string; direction: Direction }[] = (query.orderBy ?? []).map((order) => ({ field: order.field.fieldPath, direction: order.direction ?? 'ASCENDING' }));
  // A range field without an explicit ordering is ordered by it, ascending, after any explicit ones.
  for (const field of ranges) if (!ordered.some((order) => order.field === field)) ordered.push({ field, direction: 'ASCENDING' });
  return { collection, equality: [...equality].sort((a, b) => a.localeCompare(b)), ordered, ...(unsupported ? { unsupported } : {}) };
}

/** Starts recording the shape of every query any client in this process sends (it patches
 *  `Query.prototype.toProto`, the one place every query read is serialized). Returns the live list. */
export function recordQueryShapes(): QueryShape[] {
  const shapes: QueryShape[] = [];
  const proto = Query.prototype as unknown as { toProto(this: Query, ...args: unknown[]): { structuredQuery?: StructuredQuery } };
  const original = proto.toProto;
  proto.toProto = function toProto(this: Query, ...args: unknown[]) {
    const request = original.apply(this, args);
    if (request.structuredQuery) shapes.push(shapeOf(request.structuredQuery));
    return request;
  };
  return shapes;
}

/** Whether the automatic single-field indexes cannot serve `shape`. */
export function needsComposite(shape: QueryShape): boolean {
  return (shape.equality.length > 0 && shape.ordered.length > 0) || new Set(shape.ordered.map((order) => order.field)).size > 1;
}

function serves(index: IndexEntry, shape: QueryShape): boolean {
  if (index.collectionGroup !== shape.collection || index.queryScope !== 'COLLECTION') return false;
  if (index.fields.length !== shape.equality.length + shape.ordered.length) return false;
  if (index.fields.some((field) => field.order === undefined)) return false;
  const head = index.fields.slice(0, shape.equality.length).map((field) => field.fieldPath).sort((a, b) => a.localeCompare(b));
  const tail = index.fields.slice(shape.equality.length);
  return head.every((field, i) => field === shape.equality[i]) && tail.every((field, i) => field.fieldPath === shape.ordered[i].field && field.order === shape.ordered[i].direction);
}

function describe(shape: QueryShape): string {
  const ordered = shape.ordered.map((order) => `${order.field} ${order.direction}`).join(', ');
  const unsupported = shape.unsupported ? ` (unsupported: ${shape.unsupported})` : '';
  return `${shape.collection}: equality [${shape.equality.join(', ')}] then [${ordered}]${unsupported}`;
}

/** Every distinct recorded shape that needs a composite index none of `indexes` provides, or that
 *  this checker cannot judge. */
export function uncoveredShapes(shapes: readonly QueryShape[], indexes: readonly IndexEntry[]): string[] {
  const uncovered = shapes.filter((shape) => shape.unsupported !== undefined || (needsComposite(shape) && !indexes.some((index) => serves(index, shape))));
  return [...new Set(uncovered.map(describe))];
}

/** Every declared index no recorded shape uses: dead weight on every write. */
export function unusedIndexes(shapes: readonly QueryShape[], indexes: readonly IndexEntry[]): string[] {
  return indexes
    .filter((index) => !shapes.some((shape) => needsComposite(shape) && serves(index, shape)))
    .map((index) => {
      const fields = index.fields.map((field) => [field.fieldPath, field.order ?? field.arrayConfig ?? ''].join(' '));
      return `${index.collectionGroup}: ${fields.join(', ')}`;
    });
}
