/**
 * consent-flow — the gate every data-sending entry point routes through, and where declining
 * lands (design D1/D2/D5; spec ai-data-consent "The first action that would send data asks for
 * consent at that moment", "Permission is explicit and declining keeps installed apps usable").
 *
 * `LauncherRoot.tsx` imports react-native and cannot be imported under the launcher's Node suite,
 * so the gating decision lives here rather than inline in an event handler — mirrors this repo's
 * pure-logic-in-non-RN-siblings convention (`connectivity-ux.ts`, `back-policy.ts`).
 *
 * No React Native import — this module must load under the Node acceptance suite.
 */

import type { InstalledApp } from './app-index';
import type { PendingBuildRecord } from './pending-builds';
import type { ConsentStatus } from './ai-consent';
import { consentScreenActions, type ConsentScreenAction } from './consent-screen-actions';
import type { COPY } from './copy';

/**
 * What a gated action resumes once consent is current. The five entry points (the home composer
 * row, "Prompt again", the orb's change action, and history's "Change it from here" all open
 * compose; Retry on a failed/interrupted build re-runs a pending record) collapse to these two
 * shapes.
 */
export type ConsentContinuation =
  | { kind: 'compose'; editing?: InstalledApp }
  | { kind: 'retry'; record: PendingBuildRecord };

export type EntryDecision =
  | { kind: 'continue' }
  | { kind: 'ask'; continuation: ConsentContinuation };

/**
 * The one gate every data-sending entry point calls before acting (spec "Request options for
 * clarify, rewrite, generate and connectivity probes SHALL come from one gate that yields nothing
 * without a current grant"): a current grant runs the continuation immediately, `absent`/
 * `outdated` asks first. The caller attaches `continuation` to the consent screen it opens, so
 * agreeing can resume exactly where the user left off (spec "After the user agrees, the action
 * they started SHALL continue as if consent had already existed").
 */
export function entryDecision(status: ConsentStatus, continuation: ConsentContinuation): EntryDecision {
  return status.kind === 'granted' ? { kind: 'continue' } : { kind: 'ask', continuation };
}

/** The minimal shape `declineTarget` needs from the screen that opened an ask-mode consent
 *  screen — any caller's own richer screen type structurally satisfies this. */
export interface ConsentReturnScreen {
  readonly kind: string;
}

/**
 * Where declining (or system back) on an ask-mode consent screen returns to (spec "Declining
 * SHALL return the user to the screen that opened the consent screen, or to Home when that screen
 * was a running mini-app"): the screen that opened it, UNLESS that screen was a running mini-app
 * (`kind: 'app'`) — a torn-down realm is never resumed, so that one case goes Home instead.
 */
export function declineTarget<S extends ConsentReturnScreen>(returnTo: S): S | { kind: 'home' } {
  return returnTo.kind === 'app' ? { kind: 'home' } : returnTo;
}

/** One consent-screen exit button (design D6): `action` is what a press does, `label` the `COPY`
 *  key it renders — a quoted literal below, which is how the exit table's "labelled" scan (spec
 *  launcher-screen-exits "A screen without a declared exit fails the fast gate") recognises a
 *  decision module that hands back label keys rather than rendering `COPY.<key>` itself. */
export interface ConsentControl {
  readonly action: 'agree' | 'close' | 'turn-off';
  readonly label: keyof typeof COPY;
}

/** `consentScreenActions`' row action (design D5, `consent-screen-actions.ts`) to this module's
 *  `{ action, label }` pair (design D6) — the two vocabularies existed before this change and this
 *  is the one place they meet, so the table below is the whole translation, not a second copy of
 *  either. */
const CONSENT_CONTROL_BY_ACTION: Readonly<Record<ConsentScreenAction, ConsentControl>> = {
  agree: { action: 'agree', label: 'consentAgree' },
  decline: { action: 'close', label: 'consentDecline' },
  keepOn: { action: 'close', label: 'consentReviewKeepOn' },
  turnOff: { action: 'turn-off', label: 'consentReviewTurnOff' },
  turnOn: { action: 'agree', label: 'consentReviewTurnOn' },
};

/**
 * The consent screen's two buttons for a mode (design D6), built on `consent-screen-actions.ts`'s
 * `consentScreenActions` rather than a second mode → actions table:
 *
 * | mode          | primary                        | plain                                |
 * |---------------|---------------------------------|---------------------------------------|
 * | ask           | agree / consentAgree            | close / consentDecline                |
 * | review, on    | close / consentReviewKeepOn     | turn-off / consentReviewTurnOff       |
 * | review, off   | agree / consentReviewTurnOn     | close / consentDecline                |
 */
export function consentControls(
  mode: 'ask' | 'review',
  consentOn: boolean,
): { primary: ConsentControl; plain: ConsentControl } {
  const rows = consentScreenActions(mode === 'ask' ? { kind: 'ask' } : { kind: 'review', consentOn });
  const primary = rows.find((row) => row.kind === 'primary')!;
  const plain = rows.find((row) => row.kind === 'plain')!;
  return {
    primary: CONSENT_CONTROL_BY_ACTION[primary.action],
    plain: CONSENT_CONTROL_BY_ACTION[plain.action],
  };
}
