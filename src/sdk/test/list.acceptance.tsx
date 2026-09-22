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

console.log('SDK list acceptance: PASS');
