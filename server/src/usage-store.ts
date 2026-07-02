/**
 * UsageStore interface + in-memory implementation (chain-C seam).
 * NodeSqliteUsageStore (durable, chain-D) appended below.
 */
import { DatabaseSync } from 'node:sqlite';
import type { Usage } from '@whim/contract';

export interface UsageStore {
  /** Add usage to the running total for a device. */
  credit(deviceId: string, usage: Usage): Promise<void>;
  /** Return accumulated totals; zeros for unknown device IDs (never an error). */
  read(deviceId: string): Promise<Usage>;
}

/** In-memory implementation for tests and dev (non-durable; resets when the process exits). */
export class InMemoryUsageStore implements UsageStore {
  private readonly store = new Map<string, Usage>();

  async credit(deviceId: string, usage: Usage): Promise<void> {
    const prev = this.store.get(deviceId) ?? {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
    this.store.set(deviceId, {
      promptTokens: prev.promptTokens + usage.promptTokens,
      completionTokens: prev.completionTokens + usage.completionTokens,
      totalTokens: prev.totalTokens + usage.totalTokens,
    });
  }

  async read(deviceId: string): Promise<Usage> {
    return (
      this.store.get(deviceId) ?? {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      }
    );
  }
}

/**
 * Durable UsageStore backed by node:sqlite (built-in, Node 22+). Stores only a
 * per-device-id token counter — no prompt, source, bundle, or app content.
 *
 * Pass `:memory:` for a transient store (tests); pass a file path for a durable
 * store under WHIM_DATA_DIR (production). Calling `close()` releases the database
 * handle (required for restart-durability tests that open the same file twice).
 */
export class NodeSqliteUsageStore implements UsageStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage (
        device_id TEXT PRIMARY KEY,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0
      )
    `);
  }

  async credit(deviceId: string, usage: Usage): Promise<void> {
    this.db.prepare(`
      INSERT INTO usage (device_id, prompt_tokens, completion_tokens, total_tokens)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        prompt_tokens = prompt_tokens + excluded.prompt_tokens,
        completion_tokens = completion_tokens + excluded.completion_tokens,
        total_tokens = total_tokens + excluded.total_tokens
    `).run(deviceId, usage.promptTokens, usage.completionTokens, usage.totalTokens);
  }

  async read(deviceId: string): Promise<Usage> {
    const row = this.db.prepare(
      'SELECT prompt_tokens, completion_tokens, total_tokens FROM usage WHERE device_id = ?'
    ).get(deviceId) as { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;

    if (!row) {
      return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    }
    return {
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      totalTokens: row.total_tokens,
    };
  }

  /** Release the database handle. Required before re-opening the same file path. */
  close(): void {
    this.db.close();
  }
}
