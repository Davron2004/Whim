/**
 * wire-headers — the phone's own spelling of the request-envelope header names (request-envelope
 * D8). `@whim/contract` exports the same names as values, but no contract value may enter the Metro
 * bundle (zod), so the phone keeps these literals under the contract's own constant names, and
 * `checks/test/repo/header-lockstep.suite.ts` fails the fast gate when any of them differs.
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
