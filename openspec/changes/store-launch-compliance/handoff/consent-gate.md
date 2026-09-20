# consent-gate (chain-3)

Interface only; rationale is `design.md` D1, D2, D5, D7.

## `src/host/launcher/consent-flow.ts` (RN-free, Node-testable)

```ts
export type ConsentContinuation =
  | { kind: 'compose'; editing?: InstalledApp }
  | { kind: 'retry'; record: PendingBuildRecord };

export type EntryDecision = { kind: 'continue' } | { kind: 'ask'; continuation: ConsentContinuation };

export function entryDecision(status: ConsentStatus, continuation: ConsentContinuation): EntryDecision;
// 'granted' -> continue; 'absent'/'outdated' -> ask, echoing continuation back unchanged.

export interface ConsentReturnScreen { readonly kind: string; }
export function declineTarget<S extends ConsentReturnScreen>(returnTo: S): S | { kind: 'home' };
// returnTo.kind === 'app' -> { kind: 'home' } (a torn-down realm is never resumed); every other
// kind is returned as-is, fields intact.
```

## `LauncherRoot.tsx`'s `Screen` union — the `consent` member

```ts
| { kind: 'consent'; mode: 'ask'; continuation: ConsentContinuation; returnTo: Screen; outdated: boolean }
| { kind: 'consent'; mode: 'review' }
```

`returnTo` is the FULL prior `Screen` value (not a screen-kind label), captured at the moment
`openWithConsent` decided to ask — this is what makes `declineTarget<Screen>` work with no import
of `Screen` into `consent-flow.ts`. `outdated` is `status.kind === 'outdated'` at decision time.

## The five gated entry points, all in `LauncherRoot.tsx`

Each calls `openWithConsent(continuation)` instead of acting directly: the home composer row and
"Prompt again" (`{ kind: 'compose' }` / `{ kind: 'compose', editing: app }`), the orb's change
action and history's "Change it from here" (`{ kind: 'compose', editing: app }`, `returnTo` is the
`'app'`/`'history'` screen respectively), and a hydrated failure screen's Retry (`{ kind: 'retry',
record: ghost }`, wired through `failureActions`' `onRephrase`, replacing the old direct
`onRetryPending(ghost)` call). Reattaching to an already-`building` ghost (`onOpenPending`) is
UNCHANGED and ungated — it sends nothing.

`onConsentAskAgree(continuation)` grants (`grantConsent(kv, new Date().toISOString())`) then runs
the continuation via the same `runContinuation` `openWithConsent` uses. `onConsentAskDecline
(returnTo)` grants nothing and calls `setScreen(declineTarget<Screen>(returnTo))`.

Settings' AI features row opens `{ kind: 'consent', mode: 'review' }` via `onOpenAIFeaturesReview`.
Review-mode turn-on/turn-off (`onConsentReviewTurnOn`/`onConsentReviewTurnOff`) grant/revoke, both
returning to `{ kind: 'settings' }`; the safe `Keep AI features on` and hardware back both call
`onConsentReviewClose` (also just returns to Settings, no state change).

## Where `ConsentedClientOptions` is derived

```ts
const [consentTick, setConsentTick] = useState(0); // bumped by grantConsent/revokeConsent wrappers
const clientOptions = useMemo<ConsentedClientOptions | null>(
  () => consentedClientOptions(consentStatus(kv), effectiveServerUrl(kv), deviceId),
  [consentTick, serverUrl, deviceId, kv],
);
```

This REPLACES chain-2's temporary `as ConsentedClientOptions` bridge outright — no cast remains.
`clientOptions == null` whenever consent is `absent`/`outdated`; every existing `if (!clientOptions)
return;` guard in `onComposeContinue`/`openPlan`/`runAttempt` is unchanged and now doubles as the
consent gate for those three call sites. The `server-connectivity` startup/retry effect is keyed
on this SAME `clientOptions` (unchanged effect, just a new source): granting consent transitions it
from `null`, starting a fresh `ConnectivityLoop`; revoking transitions it back to `null`, and the
effect's existing cleanup stops the loop and resets `connectivity` to `'unknown'` — no new code
needed beyond the `clientOptions` derivation itself. `markOnline()` is now ALSO called (in addition
to the existing post-`clarifyPrompt`/post-`generateApp` success calls) from all three catch blocks
whenever `serviceRefusalOf(e)` is defined — a refusal proves the server answered.

## Settings section order (design D7)

AI features (opens review mode; row text via `aiFeaturesStatusLine`) → Highlighting (unchanged) →
About (`Privacy policy` / `Support`, both `Linking.openURL(RELEASE.*)`) → Advanced (collapsed
row; `advancedInitiallyOpen(serverUrl)` from `settings-sections.ts` decides the initial open state;
holds the server field, the save-time probe gated on a new `canProbe: boolean` prop — `false`
shows `COPY.settingsProbeNeutral` instead of probing — and `Use Whim's server`, shown once the
draft is non-blank, calling a new `onUseDefaultServer` prop wired to `clearServerUrl`).
`SettingsScreenProps` gained `onUseDefaultServer`, `consentStatus: ConsentStatus`, `canProbe:
boolean`, `onOpenAIFeatures: () => void`.

## `ComposeStep.tsx`

The `serverConfigured`/`onOpenSettings` props and the "set an address in Settings" notice are
GONE — compose only ever opens with consent granted, so there is nothing left to configure.
`serverUnreachable` is unchanged (advisory, still keyed off `connectivity`); `editable`/`enabled`
no longer read any configured-ness at all (`enabled={trimmed.length > 0}`).

## For chain-4 (`after: chain-3`)

`ConsentScreen.tsx`, `SettingsScreen.tsx`'s new props, and `ComposeStep.tsx`'s trimmed props are
all landed and stable. Chain-4 adds `ServiceNotice` rendering to `ComposeStep`/`ClarifyStep`/
`PlanStep`/`FailureScreen` and further reworks the SAME three `onComposeContinue`/`openPlan`/
`runAttempt` catch blocks this chain touched (for `serviceRefusalOf`) — expect to extend, not
replace, the `if (serviceRefusalOf(e)) markOnline();` lines already there.
