/**
 * The slice of node:assert and node:util the Node test harnesses use, declared here once so the
 * project needs no @types/node (the same precedent as synthrun/env.d.ts and evals/env.d.ts).
 */
declare module 'node:assert' {
  interface Assert {
    ok(value: unknown, message?: string): asserts value;
    deepStrictEqual(actual: unknown, expected: unknown, message?: string): void;
    AssertionError: new (...args: never[]) => Error;
  }
  const assert: Assert;
  export default assert;
}
declare module 'node:util' {
  export function inspect(value: unknown, options?: { depth?: number; breakLength?: number }): string;
}
