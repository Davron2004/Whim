/**
 * Entry-point wrapper around `installHermesPolyfills` (design D8). The only module in this
 * pair that imports React Native — it reads `Platform.OS` and passes it through, so
 * `process.platform` reports the real operating system React Native reports and is never
 * guessed. `index.js` imports this bare, before anything else, so the polyfills are in
 * place before the very first `react-native` or `App` module evaluates.
 */

import { Platform } from 'react-native';
import { installHermesPolyfills } from './hermes-polyfills';

const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : undefined;

installHermesPolyfills(globalThis, platform);
