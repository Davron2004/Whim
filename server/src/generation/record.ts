/**
 * server/src/generation/record.ts — assembles the delivered `WireAppRecord` (design D12,
 * `handoff/stage-contracts.md`). ONE extraction: `name`/`manifest`/`schema` come only from the
 * check stage's `CheckedManifest` (itself derived, once, from the checker's literal-only
 * `defineApp` extraction — never re-parsed here, never restated by the model); `bundle`/
 * `sourceMap` come only from the production-pinned `BuildResult`. A helper the concrete
 * `RunStage` calls once it has both in hand — `machine.ts` never invokes this directly and never
 * re-derives a record itself (design D2/D12).
 */
import type { WireAppRecord } from '@whim/contract';
import type { BuildResult, CheckedManifest } from './machine';

export function assembleRecord(source: string, manifest: CheckedManifest, build: BuildResult): WireAppRecord {
  return {
    name: manifest.name,
    source,
    bundle: build.bundle,
    sourceMap: build.sourceMap,
    manifest: manifest.manifest,
    schema: manifest.schema,
  };
}
