/**
 * build-lifecycle — one generation attempt's IDENTITY and its persisted transitions
 * (launcher-ghost-tiles design D3/D4/D5; `prompt-flow` + `pending-builds` specs).
 *
 * `LauncherRoot.tsx` keeps the stream loop, the abort controller and the screen state; this module
 * keeps the launcher id and the pending record. The split is not cosmetic: `LauncherRoot.tsx`
 * imports `react-native` and therefore cannot be imported from a Node suite, and the single most
 * important correctness property in this change is an ORDERING — `access.install`/`update` first,
 * the pending record's deletion second — which only a suite that can actually run the delivery can
 * check. So the ordering lives here, where it is watchable.
 *
 * Three rules this module exists to hold in one place:
 *   • The launcher id for an attempt is decided BEFORE the request goes out (D3). A new install
 *     mints one; a rebuild's id IS the app being rebuilt (minting a fresh one would fork the app
 *     instead of updating it); a retry reuses the failed record's. Delivery consumes that id and
 *     never mints its own.
 *   • Delivery deletes the pending record only AFTER the store and the index have both been
 *     written (D5). A crash inside delivery therefore leaves a `building` record behind, which the
 *     next launch demotes to `interrupted` — degraded, never a lost app.
 *   • A failure PERSISTS the record; only a successful delivery, a user cancel or a user dismiss
 *     deletes it (`pending-builds` spec).
 *
 * Single-writer discipline (D4) is the caller's to keep: only the `LauncherShell` instance driving
 * the attempt calls these.
 */

import type { GenerationEvent, RunSummary, WireAppRecord } from '@whim/contract';
import type { AppManifest, AppRecord } from '../bridge';
import type { SchemaArtifact } from '../storage-engine';
import type { InstalledApp } from './app-index';
import type { StoreAccess } from './store-access';
import type { PendingBuildFailure, PendingBuildRecord, PendingBuildStore } from './pending-builds';
import type { BuildScreen, RunSignals } from './prompt-flow';
import type { RunJournalStore } from './run-journal';
import { accumulateRunAggregates, ghostTileColorFor, workingTitleFromPrompt } from './prompt-flow';
import { promptEnvelope } from './prompt-envelope';
import { liftManifestTileColor } from './manifest-tile-color';
import { isAtTip } from './history-logic';

/** A fresh, sufficiently-unique launcher id for a brand-new install. Not a security-sensitive
 *  value (only used as a local index/store key), so a timestamp+random string is enough — no new
 *  dependency, mirrors `StoreAccess.fork`'s own cheap id construction in spirit. */
export function freshAppId(): string {
  // eslint-disable-next-line sonarjs/pseudo-random -- local id only, not security-sensitive
  return `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Maps a `result` event's wire app record into the host-held `AppRecord` `install`/`update`
 *  expect (design D5 "record: <mapped from wire>"). The wire's `manifest`/`schema` only need to
 *  round-trip on the wire (`ManifestShape`/`SchemaShape` are generic records) — they are
 *  structurally the same shapes `AppManifest`/`SchemaArtifact` describe, matching every fixture
 *  `APP_RECORDS` already ships. The declared tile colour is lifted onto the host record through
 *  chain-F's one mapping function, so the grid, the history header and prose all resolve one app
 *  to one colour. `schemaArtifact` is omitted entirely when the wire schema has no keys, the same
 *  "only when the app actually declares storage" convention every other record in
 *  `app-records.ts` follows.
 *
 *  `fallbackTileColor` is the colour to record when the wire declares NONE of its own — the one
 *  seam `app-launcher`'s "ghost tile colour is stable across transmute" needs. Without it the
 *  record carries no colour, every surface falls back to `tileColor`'s own `appColor(name)`, and
 *  the hue visibly flips the instant a ghost becomes a tile. It is a PARAMETER rather than an
 *  internal default because the right fallback differs per call site and only the caller knows it:
 *  a new install passes its ghost's id hash (the hue the user has been watching), a rebuild passes
 *  the colour ALREADY on the record it is rebuilding (which is preservation, not injection — an
 *  id-hash stamped over an app the user already owns, whose colour has always been the name hash
 *  and whose `record.appId` is for a fork the PARENT's, would move a colour that must not move).
 *  A declared colour always wins over either. */
export function mapWireRecord(appId: string, wire: WireAppRecord, fallbackTileColor?: string): AppRecord {
  const hasSchema = Object.keys(wire.schema).length > 0;
  const tile = liftManifestTileColor(wire.manifest).tileColor ?? fallbackTileColor;
  return {
    appId,
    name: wire.name,
    manifest: { ...(wire.manifest as unknown as AppManifest), ...(tile !== undefined ? { tileColor: tile } : {}) },
    ...(hasSchema ? { schemaArtifact: wire.schema as unknown as SchemaArtifact } : {}),
  };
}

/** What an attempt needs to know about itself before the request goes out. */
export interface AttemptStart {
  /** Present when the attempt re-prompts an installed app — a rebuild, not a new install. */
  editing?: InstalledApp;
  /** The user's VERBATIM prompt (never the rewritten one) — what the record persists. */
  text: string;
  /** Reuse an already-allocated id instead of deciding one: Retry on a `failed`/`interrupted`
   *  record, which by spec starts a new generation under the SAME launcher id. */
  reuseId?: string;
}

/**
 * Decide the launcher id this attempt will write to and persist its `building` record — both
 * BEFORE any generation request is sent (`pending-builds` "A pending-build record is created at
 * generation start"). Returns the id, which delivery must reuse unchanged.
 *
 * "Allocate the id for the attempt" means DECIDE the id this attempt writes to, not mint a fresh
 * one: a rebuild's id is the app it rebuilds, and a retry's is the record it retries. Only a
 * brand-new install has no id yet.
 */
export function startPendingBuild(pending: PendingBuildStore, start: AttemptStart): string {
  const id = start.reuseId ?? start.editing?.id ?? freshAppId();
  pending.create({
    id,
    prompt: start.text,
    workingTitle: workingTitleFromPrompt(start.text),
    ...(start.editing ? { editingAppId: start.editing.id } : {}),
  });
  return id;
}

/**
 * Fold ONE stream event into the attempt's journal AND its in-memory run signals — the whole of
 * what the shell's stream loop does with an event beyond its own screen state
 * (`generation-run-journal` spec; design D3/D6; build-liveness B1/B4). Lives here rather than in
 * the shell for the same reason the delivery ordering does: `LauncherRoot.tsx` cannot be imported
 * under Node, and the write CADENCE is the property worth watching — a `stage` event journals
 * immediately, `token`/`thinking` go through `appendAggregate`, which throttles internally, and
 * every other event writes nothing at all.
 *
 * `at` is the arrival time (the caller's single clock reading for the event). Returns the signals
 * the next event should be folded into. `lastFrameAt` moves for EVERY event this function sees
 * (build-liveness B1: "ANY frame ... starts liveness") — a `diagnostic`/`usage`/terminal event
 * still proves the connection is alive even though it journals nothing and moves no counter, so
 * this never returns the exact same object by reference the way the pre-liveness version did.
 * (The keepalive COMMENT frame is a separate case entirely — `prompt-flow.ts#withKeepalive` — it
 * never reaches this function at all, since it is not a `GenerationEvent`.)
 *
 * The token's and thinking delta's TEXT are never carried out of here: `accumulateRunAggregates`
 * counts them and discards the text, which is what keeps the counters inside the no-internals
 * rule.
 */
export function journalStreamEvent(
  journal: RunJournalStore,
  launcherId: string,
  signals: RunSignals,
  event: GenerationEvent,
  at: number,
): RunSignals {
  if (event.type === 'stage') {
    // ONE entry per stage, on its `start` edge only. The wire emits both edges (`status:
    // 'start'|'done'`), so journaling every stage event would double the timeline's spine and give
    // each stage a second, bogus duration measured across the gap to the next stage. `start` is
    // also the edge the shell's own repair tally counts, so the timeline's repair-attempt count and
    // the failure screen's can never disagree. A `done` edge is still LIVENESS — it moves the
    // any-frame clock, it just writes nothing.
    if (event.status === 'start') journal.appendStage(launcherId, event.stage);
    return { ...signals, lastFrameAt: at };
  }
  if (event.type === 'token') {
    const aggregates = accumulateRunAggregates(signals.aggregates, event);
    journal.appendAggregate(launcherId, aggregates);
    return { ...signals, aggregates, lastTokenAt: at, lastFrameAt: at };
  }
  if (event.type === 'thinking') {
    // Same throttle, same entry kind as a token's — the journal's aggregate entry carries
    // `thinkingChars` ALONGSIDE `chars`/`tokens` (build-liveness B4), never a second entry kind.
    const aggregates = accumulateRunAggregates(signals.aggregates, event);
    journal.appendAggregate(launcherId, aggregates);
    return { ...signals, aggregates, lastThinkingAt: at, lastFrameAt: at };
  }
  // `diagnostic`, `usage`, and the terminal events (handled by the caller, not here) still count
  // as liveness — the stream is plainly still alive if the server just sent one of these — but
  // none of them writes a journal entry or moves a counter.
  return { ...signals, lastFrameAt: at };
}

/**
 * D5's delivery routing: a brand-new install (no `editing`), an in-place update when `editing`
 * is at the tip of its own history, or — when it has been restored behind its own tip — a
 * silent shared continuation (fork with `shareData:true`, no question asked per decision #52 D2
 * / the `linked-apps` spec) followed by an update onto that fork. The ONLY three `StoreAccess`
 * call shapes a `result` event may produce (spec "Delivery only through StoreAccess").
 *
 * `text` is the user's VERBATIM prompt (not the rewritten one) and `summary` the run's summary
 * when it produced one — together the `{v:2, text, summary?}` envelope the snapshot tracks.
 */
export interface DeliverSpec {
  access: StoreAccess;
  /** The launcher id allocated at generation START (D3). A new install is written under THIS id;
   *  delivery never mints one of its own. Ignored on the edit paths, whose id semantics are the
   *  version store's (an at-tip update keeps the entry's id; a behind-tip continuation forks and
   *  takes the fork's). */
  appId: string;
  editing?: InstalledApp;
  text: string;
  wire: WireAppRecord;
  summary?: RunSummary;
}

export async function deliverResult(spec: DeliverSpec): Promise<InstalledApp> {
  const { access, editing, wire } = spec;
  const prompt = promptEnvelope(spec.text, spec.summary);
  const schemaJson = Object.keys(wire.schema).length > 0 ? JSON.stringify(wire.schema) : undefined;

  if (!editing) {
    // NEW INSTALL ONLY. `spec.appId` is provably the ghost the user has been watching (D3 decided
    // it before the request went out), so recording `ghostTileColorFor(spec.appId)` when the wire
    // declared no colour is what makes `app-launcher`'s "ghost tile colour ... stable across
    // transmute" true: the tile keeps the hue the ghost already had instead of jumping to
    // `appColor(name)` at delivery. Deliberately NOT pushed inside `mapWireRecord` — the two edit
    // branches below share that function and must keep their existing colour.
    const record = mapWireRecord(spec.appId, wire, ghostTileColorFor(spec.appId));
    return access.install({ id: spec.appId, name: record.name, record, bundleSource: wire.bundle, source: wire.source, prompt, example: false, schemaJson });
  }

  // This preservation also depends on `StoreAccess.update` NOT refreshing `entry.name` from
  // `record.name` (store-access.ts, `update`) — tile-colour resolution for a record with no
  // declared/injected colour hashes `app.name`, not `app.record.name`, so if `update` ever adopted
  // the new name, a rebuild that renames an app would silently move its hue. Pinned:
  // store-access.suite.ts §34.
  // Both edit branches PRESERVE, never stamp: the fallback is the colour already on the record
  // being rebuilt, so a rebuild resolves exactly the colour it resolved before. Passing nothing
  // here would not be neutral — `StoreAccess.update` replaces the record wholesale with the one
  // built from the wire alone, and a wire that declares no colour would therefore DROP a colour
  // the record had (an injected ghost hue, or an author-declared one a regenerated manifest forgot
  // to restate). An app that never had a colour still gets none, so its `appColor(name)` fallback
  // is untouched; a wire that declares one still wins.
  const record = mapWireRecord(editing.record.appId, wire, editing.record.manifest.tileColor);
  if (await isAtTip(access, editing)) {
    return access.update(editing, { record, bundleSource: wire.bundle, source: wire.source, schemaJson, prompt });
  }
  const fork = await access.fork(editing, undefined, { shareData: true });
  return access.update(fork, { record, bundleSource: wire.bundle, source: wire.source, schemaJson, prompt });
}

/**
 * Deliver a terminal `result` and settle the attempt's record. THE ORDER IS THE POINT (design D5):
 * `deliverResult` runs store-first/index-second exactly as before, and the pending record is
 * deleted only once that has RESOLVED. Deleting first — or racing the two — would turn a process
 * death mid-delivery into a silently lost attempt instead of an `interrupted` ghost the user can
 * see and retry.
 */
export async function deliverAndSettle(pending: PendingBuildStore, spec: DeliverSpec): Promise<InstalledApp> {
  const delivered = await deliverResult(spec);
  pending.delete(spec.appId);
  return delivered;
}

/** The one separator packing the failure screen's hint rows into the record's single
 *  `diagnostics` string and back. Hints are one-line product sentences, so a newline is a
 *  separator no hint can contain. */
const HINT_SEPARATOR = '\n';

/** The failure payload persisted on the record: the same plain-English `reason` the screen shows
 *  plus its HINT-ONLY rows — never a `Diagnostic`'s `kind`/`symbol`/`message`, since the record is
 *  read straight back into that same screen. No hints at all writes no field, so "none" and
 *  "absent" stay the same state they are on the wire. */
export function pendingFailure(reason: string, diagnostics: readonly { hint: string }[]): PendingBuildFailure {
  const hints = diagnostics.map((d) => d.hint).filter((hint) => hint.length > 0);
  return { reason, ...(hints.length > 0 ? { diagnostics: hints.join(HINT_SEPARATOR) } : {}) };
}

/** The failure screen's hint rows rebuilt from a persisted payload — the inverse of
 *  `pendingFailure`. An absent payload (every `interrupted` record has none) is no rows, never an
 *  invented one. */
export function hydratedDiagnostics(failure: PendingBuildFailure | undefined): { hint: string }[] {
  if (!failure?.diagnostics) return [];
  return failure.diagnostics
    .split(HINT_SEPARATOR)
    .filter((hint) => hint.length > 0)
    .map((hint) => ({ hint }));
}

/** A terminal `failure` event, or a stream that ended/threw with no terminal event: the record
 *  moves to `failed` carrying the payload and STAYS on the grid (`pending-builds` "Terminal
 *  failure or a stream error sets the record to failed with a persisted payload"). Never deletes. */
export function failPendingBuild(
  pending: PendingBuildStore,
  id: string,
  reason: string,
  diagnostics: readonly { hint: string }[],
): void {
  pending.setFailed(id, pendingFailure(reason, diagnostics));
}

/** The ONE deletion path a user can trigger: cancelling an in-flight attempt and dismissing a
 *  `failed`/`interrupted` record are the same transition — the attempt leaves no trace on the
 *  grid. Successful delivery deletes through `deliverAndSettle` instead, because only there does
 *  the ordering matter. */
export function dropPendingBuild(pending: PendingBuildStore, id: string): void {
  pending.delete(id);
}

/**
 * The build screen a Retry opens. The record persists the user's own words, not the rewritten
 * prompt the original attempt approved (`handoff/pending-store.md`: `prompt` is verbatim), so the
 * stored prompt is both the text tracked into the delivered snapshot and the prompt generation
 * runs against — there is nothing else on the record to honestly build from. The clarify exchange
 * is not replayed: its answers were never persisted either, and inventing them would put words in
 * the user's mouth.
 */
export function retryBuildScreen(rec: PendingBuildRecord, editing?: InstalledApp): BuildScreen {
  return {
    kind: 'build',
    ...(editing ? { editing } : {}),
    text: rec.prompt,
    rewritten: rec.prompt,
    answers: {},
    questions: [],
    stage: null,
    delivering: false,
  };
}
