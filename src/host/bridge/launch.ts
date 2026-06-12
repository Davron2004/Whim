/**
 * capability-bridge — the app launch sequence (Decision #41, D7). The engine `open`s BEFORE
 * the bundle runs, so a conflict-class schema failure surfaces as a structured launch error
 * and old code never executes against a store it can't open.
 *
 *   read app record → createEngine({appId}) → engine.open(schemaArtifact) → bind realm record
 *
 * The engine factory is injected (a dependency): the device passes `createStorageEngine` (op-
 * sqlite, persistent), the Node/invariant harness passes a `:memory:` engine. The realm record
 * is the single source of truth the dispatcher closes over (D2); the caller builds the
 * Dispatcher and wires the transport.
 */

import { AppRecord, RealmRecord } from './contract';
import { StorageEngine, StorageEngineError } from '../storage-engine/contract';

/** Builds a fresh per-app engine handle for the given app id. Device → op-sqlite persistent;
 *  tests → `:memory:`. */
export type EngineFactory = (appId: string) => StorageEngine;

export type LaunchResult =
  | { ok: true; realm: RealmRecord }
  | { ok: false; error: { kind: string; hint: string } };

/**
 * Launch an app into a bound realm record. If the app declares storage, the engine is created
 * and the schema opened here — a refused open (type change, tombstone violation, …) is returned
 * as a structured failure WITHOUT building a realm, so the bundle is never delivered.
 */
export function launchApp(app: AppRecord, createEngine: EngineFactory, generation = 1): LaunchResult {
  const declaresStorage = app.manifest.capabilities.includes('storage');
  let engine: StorageEngine | null = null;

  if (declaresStorage) {
    if (!app.schemaArtifact) {
      return {
        ok: false,
        error: { kind: 'missing_schema', hint: `App "${app.appId}" declares storage but ships no schema artifact.` },
      };
    }
    engine = createEngine(app.appId);
    try {
      engine.open(app.schemaArtifact);
    } catch (err) {
      try {
        engine.close();
      } catch {
        /* best effort */
      }
      if (err instanceof StorageEngineError) {
        return { ok: false, error: err.detail };
      }
      return { ok: false, error: { kind: 'launch_failed', hint: `Storage open failed: ${(err as Error)?.message}` } };
    }
  }

  const realm: RealmRecord = {
    appId: app.appId,
    manifest: app.manifest,
    schemaArtifact: app.schemaArtifact,
    engine,
    generation,
    alive: true,
  };
  return { ok: true, realm };
}
