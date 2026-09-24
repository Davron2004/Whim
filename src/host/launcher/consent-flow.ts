/**
 * consent-flow — the gate every data-sending entry point routes through, and where declining
 * lands (design D1/D2/D5; legal-surface-v2 design D5; spec ai-data-consent "The first action that
 * would send data asks for consent at that moment", "Permission is explicit and declining keeps
 * installed apps usable"; spec terms-acceptance "Terms are accepted in their own step before the
 * consent screen").
 *
 * The flow is: data-sending action → the terms step (if the terms aren't current) → the consent
 * screen (if consent isn't current) → the action the user started. Each step re-asks
 * `nextLegalStep` with fresh reads, so a step that is already current is skipped.
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
import type { TermsStatus } from './terms-acceptance';
import type { ClarifyScreen, ComposeScreen, PlanScreen } from './prompt-flow';

/**
 * What a gated action resumes once the terms and consent are current. The five entry points (the
 * home composer row, "Prompt again", the orb's change action, and history's "Change it from here"
 * all open compose; Retry on a failed/interrupted build re-runs a pending record) collapse to the
 * first two shapes. `resume` is the third: a request the server refused `consent_required`
 * (request-envelope) goes back to the flow step that sent it, exactly as it was — the typed
 * prompt, the answers and the plan rows included. `settings` is Settings' "Turn on AI features"
 * without current terms: the flow grants through its own steps and ends back on Settings.
 */
export type ConsentContinuation =
  | { kind: 'compose'; editing?: InstalledApp }
  | { kind: 'retry'; record: PendingBuildRecord }
  | { kind: 'resume'; screen: ComposeScreen | ClarifyScreen | PlanScreen }
  | { kind: 'settings' };

/** A screen of the legal flow: the terms step, then the ask-mode consent screen. */
export type LegalStep = 'terms' | 'consent';

/**
 * One pass through the legal flow, carried unchanged from step to step. `continuation` is what the
 * last step resumes; `returnTo` is the screen the first step replaced, where declining either step
 * lands (`declineTarget`); `refused` marks a flow a `consent_required` refusal started, which
 * always ends on the consent screen and heads it with the permission line.
 */
export interface LegalFlow<S> {
  readonly continuation: ConsentContinuation;
  readonly returnTo: S;
  readonly refused: boolean;
}

/**
 * The step the flow shows next, or `null` when the action may run (spec terms-acceptance "The send
 * gate requires both a terms acceptance and a consent grant"): the terms step while the terms
 * aren't accepted at `TERMS_VERSION`, then the consent screen while there is no current grant — or,
 * for a flow a `consent_required` refusal started, even over a current local grant, since the
 * server has just said it needs consent again.
 */
export function nextLegalStep(terms: TermsStatus, consent: ConsentStatus, refused: boolean): LegalStep | null {
  if (terms.kind !== 'accepted') return 'terms';
  if (refused || consent.kind !== 'granted') return 'consent';
  return null;
}

/** The minimal shape `declineTarget` needs from the screen that opened the legal flow — any
 *  caller's own richer screen type structurally satisfies this. */
export interface ConsentReturnScreen {
  readonly kind: string;
}

/**
 * Where declining (or system back) on the terms step or an ask-mode consent screen returns to
 * (spec "Declining SHALL return the user to the screen that opened the consent screen, or to Home
 * when that screen was a running mini-app"): the screen that opened the flow, UNLESS that screen
 * was a running mini-app (`kind: 'app'`) — a torn-down realm is never resumed, so that one case
 * goes Home instead.
 */
export function declineTarget<S extends ConsentReturnScreen>(returnTo: S): S | { kind: 'home' } {
  return returnTo.kind === 'app' ? { kind: 'home' } : returnTo;
}
