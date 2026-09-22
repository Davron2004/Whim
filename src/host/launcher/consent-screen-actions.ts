/**
 * consent-screen-actions — the mode → bottom-action table `ConsentScreen.tsx` renders from
 * (design D5; spec ai-data-consent "Permission is explicit and declining keeps installed apps
 * usable" — "Its decline action ..., system back, and any other exit SHALL grant nothing").
 *
 * `ConsentScreen.tsx` imports react-native and cannot be imported under the launcher's Node
 * suite, so this table lives here rather than inline in the component's JSX — the same
 * pure-logic-in-non-RN-siblings convention `consent-flow.ts` already keeps. Kept as the single
 * source `ConsentScreen.tsx` renders from, rather than a parallel description of it, so a
 * regression in the real render trips the same assertion this module's own suite makes.
 *
 * No React Native import — this module must load under the Node acceptance suite.
 */

/** One bottom action. `grants` is `true` only for the one explicit agree action a mode offers —
 *  every other row, and hardware back, SHALL leave without granting or revoking anything. */
export type ConsentScreenAction = 'agree' | 'decline' | 'keepOn' | 'turnOff' | 'turnOn';

export interface ConsentActionRow {
  readonly action: ConsentScreenAction;
  /** `primary` is the large button; `plain` is the text-only row beneath it. */
  readonly kind: 'primary' | 'plain';
  readonly grants: boolean;
}

export type ConsentScreenMode = { readonly kind: 'ask' } | { readonly kind: 'review'; readonly consentOn: boolean };

/** The bottom action rows for a mode, top to bottom, exactly as `ConsentScreen.tsx` renders them. */
export function consentScreenActions(mode: ConsentScreenMode): readonly ConsentActionRow[] {
  if (mode.kind === 'ask') {
    return [
      { action: 'agree', kind: 'primary', grants: true },
      { action: 'decline', kind: 'plain', grants: false },
    ];
  }
  if (mode.consentOn) {
    return [
      { action: 'keepOn', kind: 'primary', grants: false },
      { action: 'turnOff', kind: 'plain', grants: false },
    ];
  }
  return [
    { action: 'turnOn', kind: 'primary', grants: true },
    { action: 'decline', kind: 'plain', grants: false },
  ];
}
