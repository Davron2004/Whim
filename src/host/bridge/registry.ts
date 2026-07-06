/**
 * capability-bridge — the append-only capability registry (Decision #41, D5).
 *
 * `register(method, {capability, paramsSchema, handler})` at host startup; no unregister, no
 * override (a duplicate method name is a STARTUP error, not a silent last-wins). Rows are dumb:
 * a handler receives `(params, realmRecord)` and must derive everything it touches from those
 * two arguments — it never closes over an app id or a store. Adding capability #N+1 is exactly
 * one row here plus one client stub; if it ever needs a transport/dispatcher edit, the §5.6
 * abstraction has leaked (the review rule). The v0.3 haptics row is the immediate test of that.
 */

import { RegistryRow } from './contract';

export class CapabilityRegistry {
  private readonly rows = new Map<string, RegistryRow>();

  /** Append a row. A duplicate method name throws — appended-only, never overridden (D5). */
  register(method: string, row: RegistryRow): void {
    if (typeof method !== 'string' || !method) {
      throw new Error('capability registry: method must be a non-empty string');
    }
    if (this.rows.has(method)) {
      throw new Error(`capability registry: method "${method}" is already registered (append-only — no override)`);
    }
    if (!row || typeof row.handler !== 'function' || typeof row.paramsSchema !== 'function' || !row.capability) {
      throw new Error(`capability registry: row for "${method}" must have {capability, paramsSchema, handler}`);
    }
    this.rows.set(method, row);
  }

  lookup(method: string): RegistryRow | undefined {
    return this.rows.get(method);
  }

  has(method: string): boolean {
    return this.rows.has(method);
  }

  /** The registered method names (for diagnostics/tests). */
  methods(): string[] {
    return [...this.rows.keys()];
  }
}
