/**
 * release-config — the launcher's one release-time constant surface (design D6; spec
 * release-config "One domain constant derives every Whim URL", "The consent version is declared
 * with the release configuration"). `WHIM_DOMAIN` is declared exactly once, here, and every Whim
 * URL is derived from it. No other launcher source may hold a literal of the domain or of a
 * derived URL — `test/release-config.suite.ts` scans for and fails on that.
 *
 * `example.com` is IANA-reserved (RFC 2606): a build shipped with the placeholder can never
 * reach anyone's real server. Swapping in the real domain is a one-line edit of `WHIM_DOMAIN`.
 *
 * No React Native import — this module must load under the Node acceptance suite.
 */

export const WHIM_DOMAIN = 'example.com';

const WEB_ORIGIN = `https://whim.${WHIM_DOMAIN}`;

export const RELEASE = Object.freeze({
  /** The compiled-in production generation server (release-config "The compiled-in server is
   *  used unless the user sets an override"). */
  serverUrl: `https://api.whim.${WHIM_DOMAIN}`,
  /** Bare host the app-link parser matches against, case-insensitively. */
  webHost: `whim.${WHIM_DOMAIN}`,
  webOrigin: WEB_ORIGIN,
  privacyPolicyUrl: `${WEB_ORIGIN}/privacy`,
  supportUrl: `${WEB_ORIGIN}/support`,
  /** Every app link is this base plus `encodeURIComponent(id)` (design D15). */
  appLinkBase: `${WEB_ORIGIN}/a/`,
});

/**
 * The AI-data consent version this build asks for (design D4). The only place this value is
 * written — `ai-consent.ts#consentStatus` compares a stored grant's `version` against it, and
 * nothing else compares against a different value. Bump it whenever what Whim sends, or to whom,
 * changes.
 */
export const AI_CONSENT_VERSION = 1;
