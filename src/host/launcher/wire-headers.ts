/**
 * wire-headers — the phone's own spelling of the request-envelope header names (request-envelope
 * D8) and of the protocol level it declares (beta-1 D16). `@whim/contract` exports the same values,
 * but no contract value may enter the Metro bundle (zod), so the phone keeps these literals under
 * the contract's own constant names, and `checks/test/repo/header-lockstep.suite.ts` fails the fast
 * gate when any of them differs.
 *
 * No imports: the static check loads this module under Node.
 */

/** Request: `ios` or `android`. */
export const PLATFORM_HEADER = 'x-whim-platform';
/** Request: the installed marketing version. */
export const APP_VERSION_HEADER = 'x-whim-app-version';
/** Request: the installed build number. */
export const BUILD_HEADER = 'x-whim-build';
/** Request: the consent version the request is sent under, or `none`. */
export const CONSENT_HEADER = 'x-whim-consent';
/** Response: the id the server gave this `/v1` request. */
export const REQUEST_ID_HEADER = 'x-whim-request-id';
/** Request: the highest protocol level this build understands. */
export const PROTOCOL_HEADER = 'x-whim-protocol';
/** The protocol level this build understands: what it sends in `PROTOCOL_HEADER`, and the level its
 *  decoder (`wire-compat.ts`) reads every message against. */
export const PROTOCOL_LEVEL = 1;
