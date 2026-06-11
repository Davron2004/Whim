/**
 * Ambient surface for Node 22+'s built-in `node:sqlite`, used ONLY by the test-side binding
 * (bindings/node-sqlite.ts) under the Node acceptance runner. Declared locally so the
 * project needs no `@types/node` dependency and the device/runtime bundles — which never
 * import this module — are unaffected. Mirrors the minimal API the binding touches.
 */
declare module 'node:sqlite' {
  export interface StatementSync {
    all(...params: unknown[]): Record<string, unknown>[];
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: unknown[]): Record<string, unknown> | undefined;
  }
  export class DatabaseSync {
    constructor(path: string, options?: Record<string, unknown>);
    prepare(sql: string): StatementSync;
    exec(sql: string): void;
    close(): void;
  }
}
