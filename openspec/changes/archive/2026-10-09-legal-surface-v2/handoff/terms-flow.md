# handoff/terms-flow.md — chain-4; read by chains 5, 6, 9

## Flow order

A data-sending action (the five entry points, all through `LauncherRoot#openWithConsent`) opens:
terms step (if the terms aren't current) → ask-mode consent screen (if consent isn't current) → the continuation.
Each step re-reads the KV store and asks `nextLegalStep` again, so a current step is skipped. Declining either
step (its `Not now`, or system back) goes to `declineTarget(returnTo)` (Home for a running mini-app) and stores
nothing. A `consent_required` refusal enters the same flow with `refused: true`: terms first if they aren't current,
then always the consent screen (with `permissionRequiredLine`), then back to the sending step, prompt intact.

## State types — `src/host/launcher/consent-flow.ts` (non-RN)

```ts
export type ConsentContinuation =
  | { kind: 'compose'; editing?: InstalledApp }
  | { kind: 'retry'; record: PendingBuildRecord }
  | { kind: 'resume'; screen: ComposeScreen | ClarifyScreen | PlanScreen };

export type LegalStep = 'terms' | 'consent';

export interface LegalFlow<S> {
  readonly continuation: ConsentContinuation;
  readonly returnTo: S;
  readonly refused: boolean;
}

/** terms not 'accepted' → 'terms'; else refused or consent not 'granted' → 'consent'; else null. */
export function nextLegalStep(terms: TermsStatus, consent: ConsentStatus, refused: boolean): LegalStep | null;
export function declineTarget<S extends ConsentReturnScreen>(returnTo: S): S | { kind: 'home' };
```
`entryDecision`/`EntryDecision` are gone (replaced by `nextLegalStep`).

`LauncherRoot.tsx` `Screen` members:
```ts
| ({ kind: 'terms'; outdated: boolean } & LegalFlow<Screen>)
| ({ kind: 'consent'; mode: 'ask'; outdatedFrom?: number } & LegalFlow<Screen>)
| { kind: 'consent'; mode: 'review' }
```
`'terms'` is a `ScreenKind` in `screen-exits.ts` (`SCREEN_EXITS.terms = { back: 'screen' }`), with a fixture in
`test/screen-controls.suite.tsx`.

## The pre-terms hook (chain-9)

In `LauncherShell` (`LauncherRoot.tsx`):
```ts
const legalScreen = (flow: LegalFlow<Screen>): Screen | undefined;   // the ONLY builder of both legal screens
const advanceLegalFlow = (flow: LegalFlow<Screen>) => void;          // entry points + terms Accept: setScreen or runContinuation
const openWithConsent = (continuation: ConsentContinuation) => advanceLegalFlow({ continuation, returnTo: screen, refused: false });
const refusalScreen = (refusal, back, resume) => legalScreen({ continuation: resume, returnTo: back, refused: true }); // sync, caller guards with onlyOnStep
const onTermsAccept = (flow: LegalFlow<Screen>) => { acceptTerms(...); bumpConsent(); advanceLegalFlow(flow); };
```
A pre-terms check runs where `nextLegalStep` returns `'terms'`: the decision belongs in `nextLegalStep` (pure;
add the stored age outcome as an input and a step ahead of `'terms'`), its screen in `legalScreen`. `legalScreen`
is synchronous (the refusal path returns its result into an `onlyOnStep` updater), so an async native re-check
belongs in `advanceLegalFlow`, before its `setScreen`, never inside `legalScreen`. Both the entry path and the
refusal path reach the terms screen only through `legalScreen`.

## The gate — `src/host/launcher/transport-shared.ts`

```ts
export type ConsentedClientOptions = ClientOptions & { readonly [CONSENTED]: true };
export function consentedClientOptions(
  terms: TermsStatus, consent: ConsentStatus, baseUrl: string, deviceId: string, appInfo: () => AppInfo,
): ConsentedClientOptions | null;   // null unless terms.kind === 'accepted' AND consent.kind === 'granted'
export function reportClientOptions(status: ConsentStatus, baseUrl: string, deviceId: string, appInfo: () => AppInfo): ClientOptions; // unchanged: reports need neither
```
`consent-options.ts#liveClientOptions(kv, deviceId, appInfo)` reads `termsStatus(kv)` + `consentStatus(kv)` fresh.
The `clientOptions` memo (and so the connectivity probe and Settings' `canProbe`) is null without both records;
`acceptTerms` bumps the same `consentTick` as a grant.

## Terms acceptance — `src/host/launcher/terms-acceptance.ts` (non-RN)

Key `whim.terms:v1` (module-private), value JSON `{ version: number, acceptedAt: string }` in the `whim.launcher` KV.
```ts
export type TermsStatus =
  | { kind: 'accepted'; version: number; acceptedAt: string }
  | { kind: 'absent' }
  | { kind: 'outdated'; version: number };
export function termsStatus(kv: KVBackend): TermsStatus;   // missing / non-JSON / wrong shape → 'absent'; version ≠ TERMS_VERSION → 'outdated'
export function acceptTerms(kv: KVBackend, now: string): void;  // writes { version: TERMS_VERSION, acceptedAt: now }
```
No revoke; declining persists nothing. `release-config.ts`: `export const TERMS_VERSION = 1;` (independent of
`AI_CONSENT_VERSION`), and in `RELEASE`: `termsUrl` (`/terms`), `privacyPolicyUrlFr` (`/fr/privacy`),
`termsUrlFr` (`/fr/terms`), all on `RELEASE.webOrigin`.

## Terms copy and language — how a table supplies it (chain-6)

`LegalCopyKey` (`copy.ts`) now also holds the six terms-step keys, so every `LegalCopyTable` must supply them:
`termsTitle`, `termsLead`, `termsUpdatedLine`, `termsLabel`, `termsAccept`, `termsDecline`.
`TermsScreen.tsx` reads `LEGAL_COPY[activeLegalLanguage()]` and opens `termsUrl(language)`:
```ts
// legal-language.ts
export function termsUrl(language: LegalLanguage): string;   // TERMS_URLS[language], module-private map { en: RELEASE.termsUrl }
```
A French table adds the six keys (keys start `terms`, never `consent`, so the privacy-page quote rule doesn't apply);
the `fr` entries are `PRIVACY_POLICY_URLS.fr = RELEASE.privacyPolicyUrlFr` and `TERMS_URLS.fr = RELEASE.termsUrlFr`.
`outdated` shows `termsUpdatedLine` in place of `termsLead`. The step shows no data words and no privacy link
(`test/terms-flow-ui.suite.tsx` checks the rendered English text against English word stems; a French table
needs its own check).

English-only `COPY` key (not legal): `termsOfUseLabel` ('Terms of use'), the Settings About row between Privacy
policy and Support, opening `termsUrl(activeLegalLanguage())`.

## Test seams

`test/rendered-launcher.tsx` `LauncherSetup.terms?: boolean` (default true, calls `acceptTerms` before `consent`).
Any suite driving requests through a rendered launcher must seed both records (`acceptTerms` + `grantConsent`).
