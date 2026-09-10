/**
 * generation-request — builds the edit-flow's `GenerateRequest.app` (#52-D5, design D13).
 * Kept separate from `LauncherRoot.tsx` so it is directly Node-testable (mirrors
 * `history-logic.ts`'s split): `LauncherRoot` pulls in `react-native`/
 * `react-native-safe-area-context` and cannot be imported (only read) under Node.
 *
 * `@whim/contract` is a TYPE-ONLY import — importing the zod schema VALUES here would pull zod
 * into the Metro bundle graph (the same discipline `generation-client.ts` documents).
 */
import type { Clarification, GenerateRequest, RewriteRequest } from '@whim/contract';
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
 *
 * `clarifications` carries the clarify exchange's answers by value (the server holds no state
 * between that exchange and the request that follows it). An empty list is sent as no field at
 * all: absent and empty both mean "the user answered nothing", which is the common case.
 */
export async function buildGenerateRequest(
  access: StoreAccess,
  readApplied: AppliedSchemaReader,
  editing: InstalledApp | undefined,
  prompt: string,
  clarifications: readonly Clarification[] = [],
): Promise<GenerateRequest> {
  const answers = clarifications.length > 0 ? { clarifications: [...clarifications] } : {};
  if (!editing) return { prompt, ...answers };
  const source = await access.activeSource(editing);
  const appliedSchema = readApplied(access.engineAppId(editing));
  return {
    prompt,
    ...answers,
    app: {
      ...(source != null ? { source } : {}),
      manifest: editing.record.manifest as unknown as Record<string, unknown>,
      schema: (editing.record.schemaArtifact ?? {}) as unknown as Record<string, unknown>,
      appliedSchema: appliedSchema as unknown as Record<string, unknown>,
    },
  };
}

/** The rewrite turn's view of the app a re-prompt is changing: `RewriteRequest.app`, named so
 *  callers (the shell, `rewritePrompt`) need no inline `NonNullable<...>` gymnastics. Byte-for-byte
 *  the same shape `ClarifyRequest.app` carries — both are `AppContext` — so this one builder feeds
 *  both wire calls (`generation-client.ts#clarifyPrompt`/`#rewritePrompt`). */
export type RewriteAppContext = NonNullable<RewriteRequest['app']>;

/** `AppContext.description`'s wire cap: long past what a clarify/rewrite turn needs to know what
 *  an app currently is, and short enough that a pasted novel of a prompt cannot balloon the
 *  request. Enforced HERE (the wire boundary) as well as where the description is first resolved
 *  (`LauncherRoot.tsx#openCompose`) — a cap enforced only on the read side is not a cap. */
export const APP_CONTEXT_DESCRIPTION_MAX_CHARS = 1200;

/**
 * `RewriteRequest.app` / `ClarifyRequest.app` for the edit flow (spec "A rewrite for an edit
 * carries the app it is changing"; the clarify exchange carries the identical context so it never
 * asks what kind of app it is talking to). `undefined` when nothing is being edited — composing a
 * new app sends no `app` at all, which is exactly how the server tells the two apart.
 *
 * DISPLAY NAMES ONLY, by construction: the name the grid shows for this app, the collection/field
 * names its schema artifact is KEYED by, and an optional plain-words `description` of what the app
 * currently does (the prompt that produced its current version, `StoreAccess#activeDescription`).
 * The burned ids those keys map to (`CollectionSpec.id`, `FieldSpec.id`), the source, the bundle
 * and the user's rows are never read here — the rewrite/clarify turns write and read a product
 * description, not code, so they get the vocabulary the user would use and nothing else. A
 * collection whose fields were all retired still counts as a concept the app keeps, so it is
 * listed with an empty field list rather than dropped. `description` is trimmed to
 * `APP_CONTEXT_DESCRIPTION_MAX_CHARS` and omitted entirely when absent or empty — a best-effort
 * read that failed is a legitimate state, never a blocking one.
 *
 * Pure and synchronous — no store, no engine, no `await` — so the shell can call it inline while
 * opening compose or the plan step, and a Node suite can exercise it with a plain record.
 */
export function buildRewriteAppContext(
  editing: InstalledApp | undefined,
  description?: string,
): RewriteAppContext | undefined {
  if (!editing) return undefined;
  const collections = Object.entries(editing.record.schemaArtifact?.collections ?? {}).map(
    ([name, spec]) => ({ name, fields: Object.keys(spec.fields) }),
  );
  const trimmedDescription =
    description != null && description.length > 0
      ? description.slice(0, APP_CONTEXT_DESCRIPTION_MAX_CHARS)
      : undefined;
  // `entry.name`, NOT `entry.record.name`: the spec's "current display name" is the name the
  // user sees on the grid, and the two legitimately diverge. `StoreAccess.update` deliberately
  // never refreshes `entry.name` from the wire record on a rebuild (store-access.ts §update),
  // so after a model renamed the app unprompted, the tile still reads the user's name while
  // `record.name` reads the model's. Presenting the tile's name is what lets the next rewrite
  // heal that: the model is told the app is called what the user calls it, and keeps it.
  return {
    name: editing.name,
    ...(collections.length > 0 ? { collections } : {}),
    ...(trimmedDescription != null ? { description: trimmedDescription } : {}),
  };
}
