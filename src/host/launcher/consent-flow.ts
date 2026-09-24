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
import type { ClarifyScreen, ComposeScreen, PlanScreen } from './prompt-flow';

/**
 * What a gated action resumes once consent is current. The five entry points (the home composer
 * row, "Prompt again", the orb's change action, and history's "Change it from here" all open
 * compose; Retry on a failed/interrupted build re-runs a pending record) collapse to the first two
 * shapes. `resume` is the third: a request the server refused `consent_required` (request-envelope)
 * goes back to the flow step that sent it, exactly as it was — the typed prompt, the answers and
 * the plan rows included.
 */
export type ConsentContinuation =
  | { kind: 'compose'; editing?: InstalledApp }
  | { kind: 'retry'; record: PendingBuildRecord }
  | { kind: 'resume'; screen: ComposeScreen | ClarifyScreen | PlanScreen };

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
