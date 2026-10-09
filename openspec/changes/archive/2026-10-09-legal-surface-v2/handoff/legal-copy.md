# handoff/legal-copy.md — chain-3, rewritten after chain-6 and fix-A; read by any chain touching legal copy

## Language seam: `src/host/launcher/legal-language.ts` (non-RN)

```ts
export type LegalLanguage = 'en' | 'fr';
export function intlLocale(): string | undefined;                                   // Intl's default locale, or undefined
export function preferredLocale(intl: string | undefined, platform: string | undefined): string | undefined;
export function activeLegalLanguage(kv: KVBackend, deviceLocale: string | undefined): LegalLanguage;
export function chooseLegalLanguage(kv: KVBackend, language: LegalLanguage): void;   // persists the user's choice
export function otherLegalLanguage(language: LegalLanguage): LegalLanguage;         // what the one-tap switch offers
export function privacyPolicyUrl(language: LegalLanguage): string;                  // en RELEASE.privacyPolicyUrl, fr …Fr
export function termsUrl(language: LegalLanguage): string;                          // en RELEASE.termsUrl, fr …Fr
```
- Key `whim.legal-language:v1` (module-private) in the `whim.launcher` KV. A stored `'en'`/`'fr'` wins; otherwise
  any `fr` language subtag of `deviceLocale` (`fr-CA`, `fr_FR`, `fr`) gives French, anything else English.
- `deviceLocale` comes from the RN seam `device-locale.ts#deviceLocale()`, passed to `LauncherRoot` as the
  `deviceLocale?: () => string | undefined` prop.
- Resolved ONCE in `LauncherShell` (`useState(() => activeLegalLanguage(kv, deviceLocale()))`); a switch tap calls
  `chooseLegalLanguage` then sets the state. Every legal surface takes the language as a prop, never reads the KV:
  `ConsentScreen`, `TermsScreen`, `AgeScreen`: `language: LegalLanguage; onLanguageChange(language)`;
  `ReportSheet`, `SettingsScreen`: `legalLanguage: LegalLanguage` (their privacy/terms links only).
- `LegalLanguageSwitch.tsx`: `{ language, onChange }`, label `LEGAL_COPY[language].legalLanguageSwitch` (names the
  OTHER language, in that language).

## Copy tables: `src/host/launcher/copy.ts`

```ts
export const LEGAL_COPY_KEYS: readonly [ /* every key the age, terms and consent screens read */ ];
type LegalCopyKey = (typeof LEGAL_COPY_KEYS)[number];                 // module-private
export type LegalCopyTable = { readonly [K in LegalCopyKey]: string };
export const LEGAL_COPY: Readonly<Record<LegalLanguage, LegalCopyTable>>; // { en: COPY, fr: FRENCH }
export const CONSENT_SCREEN_COVERAGE: {
  readonly categories: Readonly<Record<string, readonly LegalCopyKey[]>>; // manifest category id → keys
  readonly roles: Readonly<Record<string, readonly LegalCopyKey[]>>;      // manifest role id → keys
};
export function consentWhatsNewText(language: LegalLanguage, grantVersion: number): string | undefined;
```
- `LEGAL_COPY_KEYS`: `terms{Title,Lead,UpdatedLine,Label,Accept,Decline}`, `age{BlockedTitle,BlockedBody,Back}` (owned by
  the age chain), `consent{Title,Lead,SentTitle,SentRequest,SentEdit,SentDevice,SentErrors,WhyTitle,Why,WhoTitle,Who,
  WhoPlatform,WhoAuthorities,StaysTitle,Stays,NeverTitle,Never,AskFirst,Footnote,OutdatedLine,Agree,Decline,
  ReviewKeepOn,ReviewTurnOff,ReviewTurnOn}`, `permissionRequiredLine`, `privacyPolicyLabel`, `legalLanguageSwitch`.
  English is `COPY` itself; `FRENCH` (module-private) is a `LegalCopyTable`: Canadian French, "vous", a
  non-breaking space (` `) before `:` and `;`.
- Coverage: categories `request-material` → `[consentSentRequest, consentSentEdit]`, `phone-id` → `[consentSentDevice]`,
  `error-details` → `[consentSentErrors]`; roles `anycognition`, `ai-providers`, `hosting-providers` → `[consentWho]`,
  `platform` → `[consentWhoPlatform]`, `authorities` → `[consentWhoAuthorities]`. A new on-screen category or
  screen-named role needs an entry here.
- Report-sheet and Settings keys stay English-only `COPY` keys, outside `LEGAL_COPY_KEYS`.
- `consentStays` says what Whim does with saved data ("Whim doesn’t send it anywhere"), not where it can go; "It stays
  on your phone" may return once platform-release-readiness 13.6/13.7 pass (task 11.8). Wording only: no bump.

## What's-new lines

```ts
export interface ConsentWhatsNewLine {
  readonly text: string;
  readonly covers: Readonly<Record<string, string>>;   // widening id → the phrase of `text` that names it
}
export const CONSENT_WHATS_NEW: Readonly<Record<string, Readonly<Record<number, ConsentWhatsNewLine>>>>;
// language → the grant's consent version → line. Today: { en: { 1 }, fr: { 1 } }.
```
- Every language has its OWN `covers` (no shared list): ids = `diffManifests(MANIFESTS[v], MANIFESTS[current])`, and each
  phrase must occur verbatim in that language's `text`. Several ids may share one phrase (`naming(phrase, ids)`,
  module-private).
- Checked by `disclosureReleaseFindings` (contract): a missing or extra id, a blank phrase, or a phrase the text doesn't
  say fails, naming the language, the version and the id (`what's-new (fr) for version 1 does not say "…", its phrase
  for keep:reports`).
- v1 → v2 ids (33): `category:{app-integrity,error-details}`, `keep:{reports,usage-records}`,
  `purpose:connection-logs:{legal,operate,safety}`, `purpose:{phone-id,reports}:legal`,
  `purpose:request-material:{legal,operate}`, `purpose:usage-records:{legal,operate,safety}`,
  `recipient:<c>:{authorities,hosting-providers,successor}` for each c of `connection-logs`, `phone-id`, `reports`,
  `request-material`, `usage-records`, and `role:{authorities,hosting-providers,platform,successor}`.
- The screen reads only `consentWhatsNewText(language, version)`; `undefined` → the outdated line alone.
  Ask mode with `outdatedFrom` renders `consentOutdatedLine` (danger), then the text as a plain paragraph (never through
  `render.ts`), above the title.

## Coverage check (gate): `checks/test/repo/consent-coverage.suite.ts`

```ts
export function consentCoverageFindings(input: ConsentCoverageInput): string[];   // [] = covered
export interface ConsentCoverageInput {
  readonly manifest: DisclosureManifest; readonly olderVersions: readonly number[];
  readonly coverage: { readonly categories: …; readonly roles: … };      // CONSENT_SCREEN_COVERAGE
  readonly tables: Readonly<Record<string, Readonly<Record<string, string>>>>;  // LEGAL_COPY
  readonly legalKeys: readonly string[];                                  // LEGAL_COPY_KEYS
  readonly whatsNew: Readonly<Record<string, Readonly<Record<number, { readonly text: string }>>>>;
}
```
Refuses: an on-screen category or screen-named role with no coverage entry; a covered key, a `LEGAL_COPY_KEYS` key, or
any `consent*` key of any table blank in some table; a table with no non-blank what's-new line for an older version;
any `consent*`/`report*` string or what's-new line matching `/open\s*router/i` or `/anonym/i`.

## The privacy pages quote the screen (`server/test/web-site.suite.ts`)

- `/privacy` quotes every `COPY` key starting `consent`, and `/fr/privacy` every such `LEGAL_COPY.fr` key, verbatim after
  normalization (tags stripped, entities decoded, whitespace collapsed, ’ = '). Allowlist: `consentTitle`,
  `consentOutdatedLine`, `consentAgree`, `consentDecline`, `consentReviewKeepOn`, `consentReviewTurnOff`,
  `consentReviewTurnOn`. So a changed `consent*` string changes both pages in the same commit.
- Neither page names OpenRouter outside `<section id="providers">`, names a model vendor, or says "anonym".
- While `src/native/NativeWhimAgeSignal.ts` exists, each policy carries `<p id="age-signal">` stating the re-ask period
  the built `age-check.ts` uses (`30 days` / `30 jours`) and that nothing about age leaves the phone.
