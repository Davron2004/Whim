/**
 * settings-sections — pure Settings-screen derivations (design D7; spec app-launcher "Settings
 * groups its controls into titled sections, with the server address under Advanced").
 *
 * `SettingsScreen.tsx` imports react-native and cannot be imported under the launcher's Node
 * suite, so this one piece of derivation logic lives here rather than inline in the component's
 * initial `useState` — mirrors this repo's pure-logic-in-non-RN-siblings convention
 * (`connectivity-ux.ts`, `settings-probe.ts`).
 *
 * No React Native import — this module must load under the Node acceptance suite.
 */

/**
 * Whether the Advanced section renders open the moment Settings mounts (spec "renders already
 * open while an override is saved"): open when a non-blank override is currently saved, collapsed
 * otherwise. A pure INITIAL value only — read once by the screen's own `useState` initializer;
 * whether Advanced is open is never persisted (same spec).
 */
export function advancedInitiallyOpen(override: string | undefined): boolean {
  return override != null && override.trim().length > 0;
}
