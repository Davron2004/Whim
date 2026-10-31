import * as React from 'react';
import { act, create } from 'react-test-renderer';
import { List } from '../index';

function fail(message: string): never {
  throw new Error(message);
}

function equal(actual: unknown, expected: unknown): void {
  if (actual !== expected) fail(`expected ${String(expected)}, received ${String(actual)}`);
}

function isDuplicateKeyDiagnostic(args: unknown[]): boolean {
  return args.some(
    (arg) =>
      typeof arg === 'string' &&
      (/Encountered two children with the same key/.test(arg) || /unique "key" prop/.test(arg)),
  );
}

const diagnostics: unknown[][] = [];
const originalError = console.error;
console.error = (...args: unknown[]) => diagnostics.push(args);
let renderer: ReturnType<typeof create> | undefined;
try {
  await act(async () => {
    renderer = create(React.createElement(List, null, 'repeat', 'repeat', 7, 7));
  });
} finally {
  console.error = originalError;
}

equal(diagnostics.filter(isDuplicateKeyDiagnostic).length, 0);

// A `List` that renders nothing would also pass the no-duplicate-key check above — assert the
// four children actually rendered, one wrapper `div` per child under the List's own outer `div`.
const tree = renderer!.toJSON();
if (tree === null || Array.isArray(tree)) fail(`expected a single outer List element, got ${JSON.stringify(tree)}`);
const wrappers = tree.children ?? [];
equal(wrappers.length, 4);

// ── Keyed lists (system.md §7.2: `items`/`keyBy`/`renderItem`) ─────────────────
// Rows keep their identity by key: removing one row unmounts that row only, so motion (chain-6)
// can play on exactly it. Duplicate, positional or missing keys record one diagnostic and turn the
// list's motion off for good, while every row still renders under a unique React key.

interface Item {
  id: number | string;
  name: string;
}

/** A row that reports its mounts and unmounts by name, like a row with its own state would feel. */
const lifecycle: string[] = [];
function Probe({ name }: { name: string }) {
  React.useEffect(() => {
    lifecycle.push(`mount ${name}`);
    return () => {
      lifecycle.push(`unmount ${name}`);
    };
  }, [name]);
  return React.createElement('span', null, name);
}

type KeyBy = Parameters<typeof List<Item>>[0] extends infer P ? (P extends { keyBy: infer K } ? K : never) : never;

function keyed(items: Item[], keyBy: KeyBy): React.ReactElement {
  return React.createElement(List<Item>, { items, keyBy, renderItem: (item: Item) => React.createElement(Probe, { name: item.name }) });
}

/** Renders `first`, then each later element, capturing console.error/warn along the way. */
async function renderSequence(...elements: React.ReactElement[]) {
  const errors: unknown[][] = [];
  const warnings: unknown[][] = [];
  const saved = { error: console.error, warn: console.warn };
  console.error = (...args: unknown[]) => errors.push(args);
  console.warn = (...args: unknown[]) => warnings.push(args);
  let r: ReturnType<typeof create> | undefined;
  const motions: unknown[] = [];
  try {
    for (const element of elements) {
      await act(async () => {
        if (r) r.update(element);
        else r = create(element);
      });
      const root = r!.toJSON();
      if (root === null || Array.isArray(root)) fail('a List renders one element');
      motions.push(root.props['data-list-motion']);
    }
    const texts = r!.root.findAll((n) => n.type === 'span').map((n) => n.children.join(''));
    const rowLifecycle = lifecycle.join(', ');
    await act(async () => r!.unmount());
    return { errors, warnings, motions, texts, rowLifecycle };
  } finally {
    console.error = saved.error;
    console.warn = saved.warn;
  }
}

/** Compile-time only: `keyBy` names a string or number property of the items, or is a function. */
export function keyByIsTyped(rows: { id: number; tags: string[] }[]): React.ReactElement[] {
  return [
    React.createElement(List<{ id: number; tags: string[] }>, { items: rows, keyBy: 'id', renderItem: () => null }),
    // @ts-expect-error a property the items don't have is not a key.
    React.createElement(List<{ id: number; tags: string[] }>, { items: rows, keyBy: 'nope', renderItem: () => null }),
    // @ts-expect-error an array property can't be a key.
    React.createElement(List<{ id: number; tags: string[] }>, { items: rows, keyBy: 'tags', renderItem: () => null }),
  ];
}

const A = { id: 1, name: 'a' };
const B = { id: 2, name: 'b' };
const C = { id: 3, name: 'c' };

// Removing the middle row of three unmounts that row only, and the list keeps its motion.
{
  lifecycle.length = 0;
  const run = await renderSequence(keyed([A, B, C], 'id'), keyed([A, C], 'id'));
  equal(run.rowLifecycle, 'mount a, mount b, mount c, unmount b');
  equal(run.motions.join(','), 'on,on');
  equal(run.warnings.length, 0);
  equal(run.texts.join(','), 'a,c');
}

// A keyBy function keys the same way: adding a row at the front mounts only that row.
{
  lifecycle.length = 0;
  const D = { id: 'd-1', name: 'd' };
  const run = await renderSequence(keyed([A, B], (item) => item.id), keyed([D, A, B], (item) => item.id));
  equal(run.rowLifecycle, 'mount a, mount b, mount d');
  equal(run.motions.join(','), 'on,on');
}

// Index-shaped keys: one diagnostic, no motion, and the flag stays off once the keys look fine.
{
  const rows = [A, B, C];
  const byPosition = (item: Item) => rows.indexOf(item as typeof A);
  const run = await renderSequence(keyed(rows, byPosition), keyed([A, B, C], 'id'));
  equal(run.warnings.length, 1);
  if (!/positions/.test(String(run.warnings[0][0]))) fail(`the diagnostic names the positional keys: ${String(run.warnings[0][0])}`);
  equal(run.motions.join(','), 'off,off');
}

// Duplicate keys: one diagnostic, no motion, every row still rendered, React never warns.
{
  const twin = { id: 1, name: 'a twin' };
  const run = await renderSequence(keyed([A, twin, B], 'id'));
  equal(run.warnings.length, 1);
  if (!/used by two rows/.test(String(run.warnings[0][0]))) fail(`the diagnostic names the duplicate: ${String(run.warnings[0][0])}`);
  equal(run.motions.join(','), 'off');
  equal(run.texts.join(','), 'a,a twin,b');
  equal(run.errors.filter(isDuplicateKeyDiagnostic).length, 0);
}

// A row without a usable key is a diagnostic too, never a crash.
{
  const keyless = { name: 'no id' } as unknown as Item;
  const run = await renderSequence(keyed([A, keyless], 'id'));
  equal(run.warnings.length, 1);
  equal(run.motions.join(','), 'off');
  equal(run.texts.join(','), 'a,no id');
}

// A children-style List never carries the motion flag: it stays still.
{
  const run = await renderSequence(React.createElement(List, null, React.createElement(Probe, { name: 'x' })));
  equal(run.motions.join(','), '');
}

console.log('SDK list acceptance: PASS');
