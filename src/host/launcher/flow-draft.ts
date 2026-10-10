/**
 * flow-draft — the making sheet's draft (design-system-v1 task 16.1; `prompt-flow` "Leaving the
 * making sheet keeps the run and the draft").
 *
 * Closing the sheet on Describe or Plan keeps what the person had: the words, the answers and any
 * plan edits are the page's own state, so the draft IS the page that was left. One draft is kept
 * for a new app and one for each app being changed, in memory for the session; the composer reads
 * the new-app one. A draft is cleared when `Make it` starts the run or the words are emptied.
 *
 * No React Native import — this module must load under the Node acceptance suite.
 */

import type { InstalledApp } from './app-index';
import type { DescribeScreen, PlanScreen } from './prompt-flow';

/** The page a draft restores. */
export type FlowDraftScreen = DescribeScreen | PlanScreen;

/** The key of the draft for a new app. */
export const NEW_APP_DRAFT_KEY = 'new-app';

/** Which draft a page belongs to: the app it changes, else the new-app draft. */
export function draftKey(page: { readonly editing?: { readonly id: string } }): string {
  return page.editing?.id ?? NEW_APP_DRAFT_KEY;
}

/** `page` for the app as it is now. A draft holds the app as it was when it was kept (a new version,
 *  a new name, a customised tile since), and the requests the plan page sends carry that app's name
 *  and context; the plan a Describe page returns to holds it too. */
export function withEditing(page: FlowDraftScreen, editing: InstalledApp): FlowDraftScreen {
  if (page.kind === 'plan') return { ...page, editing };
  return { ...page, editing, ...(page.kept ? { kept: { ...page.kept, editing } } : {}) };
}

/** The longest start of the words the composer shows, in characters. */
const PREVIEW_MAX_CHARS = 24;

/**
 * The start of a draft's words as the composer shows it: the first words that fit in
 * `PREVIEW_MAX_CHARS`, cut at a word boundary, with an ellipsis when something was left out.
 * Whitespace runs collapse, so a multi-line draft reads as one line.
 */
export function draftPreview(text: string): string {
  const words = text.trim().replace(/\s+/g, ' ');
  if (words.length <= PREVIEW_MAX_CHARS) return words;
  const cut = words.slice(0, PREVIEW_MAX_CHARS + 1);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > 0 ? cut.slice(0, boundary) : cut.slice(0, PREVIEW_MAX_CHARS)).trimEnd()}…`;
}

/** The session's drafts, by `draftKey`. */
export class FlowDrafts {
  private readonly byKey = new Map<string, FlowDraftScreen>();

  /** The page last left for this app (or the new-app draft), if the person had words on it. */
  get(key: string): FlowDraftScreen | undefined {
    return this.byKey.get(key);
  }

  /** Keep `page` as the draft of its key; a page with no words is no draft and clears it. */
  keep(page: FlowDraftScreen): void {
    const key = draftKey(page);
    if (page.text.trim() === '') this.byKey.delete(key);
    else this.byKey.set(key, page);
  }

  clear(key: string): void {
    this.byKey.delete(key);
  }

  /** The draft to reopen for `requested`, for the app as it is now (`live`; undefined once it is
   *  gone, which takes its draft with it). */
  reopen(requested: InstalledApp | undefined, live: InstalledApp | undefined): FlowDraftScreen | undefined {
    const key = draftKey({ editing: requested });
    if (requested && !live) this.clear(key);
    const draft = this.get(key);
    return draft && live ? withEditing(draft, live) : draft;
  }

  /** The new-app draft's words, as the composer shows them, or `undefined` when there is none. */
  composerWords(): string | undefined {
    return this.byKey.get(NEW_APP_DRAFT_KEY)?.text;
  }
}
