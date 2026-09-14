/**
 * report-payload — the report draft/body/preview/log-fields shaping (design D13/D14; spec
 * "content-reporting"). RN-free: `ReportSheet.tsx` (a later chain) is the only caller that
 * touches React Native.
 *
 * `ReportRequest`/`ReportReason` are imported TYPE-ONLY from `./contract-mirror` (a client-local
 * stand-in for `@whim/contract`'s not-yet-landed export — see that module's doc comment), so this
 * module pulls no zod into the Metro bundle graph.
 */
import type { ReportReason, ReportRequest } from './contract-mirror';
import type { InstalledApp } from './app-index';
import type { StoreAccess } from './store-access';

/** The note's input cap (content-reporting §"The report sheet collects a reason and an optional
 *  note") and the app name's cap (same section) — kept in lockstep with `contract-mirror.ts`'s
 *  `ReportRequest` bounds, which the Node suite ties to the real (future) contract schema. */
const MAX_NOTE_LENGTH = 1000;
const MAX_APP_NAME_LENGTH = 200;

/** Everything the report sheet holds before Send: a reason (`null` until chosen), the note as
 *  typed (unbounded here — the sheet's `maxLength` stops it at input time, task 5.2), the app's
 *  display name, and the prompt/source pulled from the version store alongside each field's
 *  include-switch state (on by default, design D14). `prompt`/`source` are `undefined` exactly
 *  when the entry has none to offer — never a placeholder string. */
export interface ReportDraft {
  readonly reason: ReportReason | null;
  readonly note: string;
  readonly appName: string;
  readonly prompt?: string;
  readonly promptIncluded: boolean;
  readonly source?: string;
  readonly sourceIncluded: boolean;
}

/** Build the exact `ReportRequest` Send posts, or `null` when no reason is chosen (design D14).
 *  The note is trimmed and omitted when empty, then cut to `MAX_NOTE_LENGTH`; `appName` is cut to
 *  `MAX_APP_NAME_LENGTH`; `prompt`/`source` are dropped when their switch is off OR the field is
 *  absent — switched-off and absent collapse to the same "omit the key" outcome. */
export function buildReportRequest(draft: ReportDraft): ReportRequest | null {
  if (draft.reason === null) {
    return null;
  }
  const trimmedNote = draft.note.trim();
  const note = trimmedNote.length > 0 ? trimmedNote.slice(0, MAX_NOTE_LENGTH) : undefined;
  const prompt = draft.promptIncluded && draft.prompt !== undefined ? draft.prompt : undefined;
  const source = draft.sourceIncluded && draft.source !== undefined ? draft.source : undefined;
  return {
    reason: draft.reason,
    ...(note !== undefined ? { note } : {}),
    appName: draft.appName.slice(0, MAX_APP_NAME_LENGTH),
    ...(prompt !== undefined ? { prompt } : {}),
    ...(source !== undefined ? { source } : {}),
  };
}

/** One row of the "what gets sent" preview (content-reporting §"The sheet previews exactly the
 *  body that Send transmits"). `value` is the EXACT value the same-named `ReportRequest` field
 *  holds — the preview and the posted body can never disagree because both read off one
 *  `ReportRequest` value, never off the draft directly. */
export interface ReportPreviewRow {
  readonly field: 'reason' | 'note' | 'appName' | 'prompt' | 'source';
  readonly value: string;
}

/** The preview rows for `request`, in display order. `note`/`prompt`/`source` rows appear only
 *  when the request itself carries that key — omitted, not empty, exactly mirroring what Send
 *  transmits (design D14). */
export function reportPreview(request: ReportRequest): readonly ReportPreviewRow[] {
  const rows: ReportPreviewRow[] = [{ field: 'reason', value: request.reason }];
  if (request.note !== undefined) {
    rows.push({ field: 'note', value: request.note });
  }
  rows.push({ field: 'appName', value: request.appName ?? '' });
  if (request.prompt !== undefined) {
    rows.push({ field: 'prompt', value: request.prompt });
  }
  if (request.source !== undefined) {
    rows.push({ field: 'source', value: request.source });
  }
  return rows;
}

function byteLengthOf(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** What a report is allowed to leave in a log record (host-observability delta; spec
 *  "Report content never reaches device logs"): the reason, the BYTE SIZES of the included
 *  prompt and source (never their text), and the caller-supplied outcome (a status class, e.g.
 *  `'202'`, or a `ServiceRefusalCode`). The note, prompt, source, and app name text never appear
 *  here — there is no field that could carry them. */
export interface ReportLogFields {
  readonly reason: ReportReason;
  readonly promptBytes?: number;
  readonly sourceBytes?: number;
  readonly outcome: string;
}

export function reportLogFields(request: ReportRequest, outcome: string): ReportLogFields {
  return {
    reason: request.reason,
    ...(request.prompt !== undefined ? { promptBytes: byteLengthOf(request.prompt) } : {}),
    ...(request.source !== undefined ? { sourceBytes: byteLengthOf(request.source) } : {}),
    outcome,
  };
}

/** The draft every report entry point starts from (design D13): the app's display name
 *  (`InstalledApp.name`), the prompt behind its current version (`StoreAccess.activeDescription`),
 *  and its stored original source (`StoreAccess.activeSource`) — both switches on by default, no
 *  reason chosen yet. Opening the sheet sends nothing: this only reads. */
export async function reportDraftFor(entry: InstalledApp, access: StoreAccess): Promise<ReportDraft> {
  const [prompt, source] = await Promise.all([access.activeDescription(entry), access.activeSource(entry)]);
  return {
    reason: null,
    note: '',
    appName: entry.name,
    prompt,
    promptIncluded: true,
    source,
    sourceIncluded: true,
  };
}
