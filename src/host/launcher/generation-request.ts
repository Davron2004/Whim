/**
 * generation-request — builds the edit-flow's `GenerateRequest.app` (#52-D5, design D13).
 * Kept separate from `LauncherRoot.tsx` so it is directly Node-testable (mirrors
 * `history-logic.ts`'s split): `LauncherRoot` pulls in `react-native`/
 * `react-native-safe-area-context` and cannot be imported (only read) under Node.
 *
 * `@whim/contract` is a TYPE-ONLY import — importing the zod schema VALUES here would pull zod
 * into the Metro bundle graph (the same discipline `generation-client.ts` documents).
 */
import type { GenerateRequest } from '@whim/contract';
import type { AppliedSchema } from '../storage-engine/schema';
import type { InstalledApp } from './app-index';
import type { StoreAccess } from './store-access';

/**
 * Reads a storage group's LIVE, accumulated applied-schema union for `appId` (always called
 * with `access.engineAppId(entry)`) — side-effect-free: applies no artifact, runs no DDL,
 * returns `emptyApplied()` for a database that has never been created. Injected so this module
 * stays op-sqlite-free: `LauncherRoot` supplies the device peek (`peekAppliedSchema` from
 * `../storage-engine`); the Node suite supplies a file-backed one built the same way
 * `shared-storage.suite.ts` builds its file-backed engine factory.
 */
export type AppliedSchemaReader = (appId: string) => AppliedSchema;

/**
 * `GenerateRequest.app` for the edit flow (design D5/D13). `undefined` for the new-app flow
 * (`editing` absent), which sends no `app` at all — unchanged from before this change.
 *
 * For an edit: `source` is included ONLY when the active snapshot has a genuine `source.ts`
 * artifact (`StoreAccess.activeSource`) — omitted entirely for a legacy snapshot, never
 * substituted with compiled bundle text. `appliedSchema` is ALWAYS sourced from `readApplied`
 * for `access.engineAppId(entry)` — the storage group's live accumulated union — NEVER from
 * `entry.record.schemaArtifact` (the entry's own declared schema, which `schema` below still
 * carries unchanged; the two fields can legitimately differ for a grouped entry).
 */
export async function buildGenerateRequest(
  access: StoreAccess,
  readApplied: AppliedSchemaReader,
  editing: InstalledApp | undefined,
  prompt: string,
): Promise<GenerateRequest> {
  if (!editing) return { prompt };
  const source = await access.activeSource(editing);
  const appliedSchema = readApplied(access.engineAppId(editing));
  return {
    prompt,
    app: {
      ...(source != null ? { source } : {}),
      manifest: editing.record.manifest as unknown as Record<string, unknown>,
      schema: (editing.record.schemaArtifact ?? {}) as unknown as Record<string, unknown>,
      appliedSchema: appliedSchema as unknown as Record<string, unknown>,
    },
  };
}
