# handoff/legal-copy.md — chain-3; read by chains 4, 5, 6, 7

## Language seam: `src/host/launcher/legal-language.ts` (non-RN)

```ts
export type LegalLanguage = 'en';                                // chain-6 widens to 'en' | 'fr'
export function activeLegalLanguage(): LegalLanguage;            // returns 'en' until task 6.1
export function privacyPolicyUrl(language: LegalLanguage): string; // PRIVACY_POLICY_URLS[language], from RELEASE
```
Called by `ConsentScreen.tsx` (copy table + privacy link), `ReportSheet.tsx` and `SettingsScreen.tsx` (privacy links).
Legal surfaces read `LEGAL_COPY[activeLegalLanguage()]` and `privacyPolicyUrl(language)`, never `RELEASE.privacyPolicyUrl`;
the URL map is module-private, and a new language adds its entry there.

## Copy tables: `src/host/launcher/copy.ts`

```ts
type LegalCopyKey =            // module-private union; a new legal screen's keys join it
  | 'consentTitle' | 'consentLead' | 'consentWhyTitle' | 'consentWhy' | 'consentAskFirst' | 'consentFootnote'
  | 'consentSentTitle' | 'consentSentRequest' | 'consentSentEdit' | 'consentSentDevice' | 'consentSentErrors'
  | 'consentWhoTitle' | 'consentWho' | 'consentWhoPlatform' | 'consentWhoAuthorities' | 'consentOutdatedLine'
  | 'consentStaysTitle' | 'consentStays' | 'consentNeverTitle' | 'consentNever'
  | 'consentAgree' | 'consentDecline' | 'consentReviewKeepOn' | 'consentReviewTurnOff' | 'consentReviewTurnOn'
  | 'permissionRequiredLine' | 'privacyPolicyLabel';
export type LegalCopyTable = { readonly [K in LegalCopyKey]: string };
export const LEGAL_COPY: Readonly<Record<LegalLanguage, LegalCopyTable>> = { en: COPY };  // English IS `COPY`
export const CONSENT_SCREEN_COVERAGE: {
  readonly categories: Readonly<Record<string, readonly LegalCopyKey[]>>;   // manifest category id → keys
  readonly roles: Readonly<Record<string, readonly LegalCopyKey[]>>;        // manifest role id → keys
};
// categories: request-material → [consentSentRequest, consentSentEdit], phone-id → [consentSentDevice], error-details
// → [consentSentErrors]; roles: anycognition, service-providers → [consentWho]; platform → [consentWhoPlatform];
// authorities → [consentWhoAuthorities]
```
A new language table (`fr`) is a plain object typed `LegalCopyTable`: every key above. The compiler enforces presence;
the coverage check enforces non-empty. Report-sheet keys (`reportDeviceIdLine`, `reportThanksTitle`, …) are
English-only `COPY` keys. The v1 keys `consentWhatSent*`, `consentWhatNeverSent*` and `reportAnonIdLine` are gone.
"Who gets it" renders as one paragraph, `` `${consentWho} ${consentWhoPlatform} ${consentWhoAuthorities}` `` (one key
per screen-named role, so a dropped role is detectable).

## What's-new: how the screen reads `CONSENT_WHATS_NEW`

Shape unchanged from chain-1: `Readonly<Record<string, Readonly<Record<number, ConsentWhatsNewLine>>>>`, language → grant
version → `{ text, covers }`. Read only through:
```ts
export function consentWhatsNewText(language: LegalLanguage, grantVersion: number): string | undefined; // copy.ts
```
`undefined` (no line for that version, e.g. a grant from a newer build) → the screen shows the outdated line alone.
Plumbing (`ai-consent.ts`, `ConsentScreen.tsx`, `LauncherRoot.tsx`):
```ts
export type ConsentStatus =
  | { kind: 'granted'; version: number; grantedAt: string } | { kind: 'absent' } | { kind: 'outdated'; version: number };
export function outdatedGrantVersion(status: ConsentStatus): number | undefined;   // the outdated grant's version
// ConsentScreenProps.outdatedFrom?: number  (replaces `outdated?: boolean`; ask mode only)
// Screen { kind: 'consent'; mode: 'ask'; …; outdatedFrom?: number; refused?: boolean }
```
Ask mode with `outdatedFrom` renders, above the title: `consentOutdatedLine` (danger), then the what's-new text as a
plain body paragraph (no `numberOfLines`, never routed through `render.ts`). `refused` without `outdatedFrom` shows
`permissionRequiredLine` instead. Screen order after that: title, lead, "What gets sent" (four bullets), why, who,
stays, never, ask-first, footnote, privacy link, then the action buttons.

## Coverage check (gate)

Entry: `checks/test/repo/consent-coverage.suite.ts` → `run()`, called from `main()` in `checks/test/acceptance.ts`
(after `runHeaderLockstep()`). Pure core:
```ts
export function consentCoverageFindings(input: ConsentCoverageInput): string[];   // [] = covered
export interface ConsentCoverageInput {
  readonly manifest: DisclosureManifest;           // live: MANIFESTS[latestVersion()]
  readonly olderVersions: readonly number[];       // live: every manifest version below the latest
  readonly coverage: { readonly categories: Readonly<Record<string, readonly string[]>>; readonly roles: Readonly<Record<string, readonly string[]>> }; // live: CONSENT_SCREEN_COVERAGE
  readonly tables: Readonly<Record<string, Readonly<Record<string, string>>>>;     // live: LEGAL_COPY
  readonly whatsNew: Readonly<Record<string, Readonly<Record<number, { readonly text: string }>>>>; // CONSENT_WHATS_NEW
}
```
Refuses: an on-screen category or screen-named role with no `CONSENT_SCREEN_COVERAGE` entry; a covered key missing or
blank in any `LEGAL_COPY` table; a `LEGAL_COPY` language with no non-blank `CONSENT_WHATS_NEW[lang][v]` for every
older version `v`; any key matching `/^(consent|report)/` in any table, or any what's-new line, matching
`/open\s*router/i` or `/anonym/i` (the latter also catches French "anonyme"). A new language table must therefore
supply: every `LegalCopyKey`, and a what's-new line for every older version (same `covers`, which chain-1's release
check verifies per language). Chain-6's "every legal key in both tables" check (6.3) extends this suite. The launcher
UI suite (`consent-gate-ui.suite.tsx`) holds the other half: the rendered screen shows every covered key, in spec order.

## Disclosure strings `deploy/site/privacy.html` must quote word for word (chain-7)

`server/test/web-site.suite.ts` requires every `COPY` key starting with `consent`, except its allowlist, to appear in
the rendered page after normalization (tags stripped, `&amp; &lt; &gt; &quot; &#39;` decoded, whitespace collapsed,
’ and ' compared equal; case-sensitive). Allowlist (unchanged): `consentTitle`, `consentOutdatedLine`, `consentAgree`,
`consentDecline`, `consentReviewKeepOn`, `consentReviewTurnOff`, `consentReviewTurnOn`. Section titles are NOT
allowlisted: "What we never do" and "What you save in your apps" carry the meaning of the sentence under them.

| key | text |
|---|---|
| consentLead | To build or change an app, Whim sends what you ask for to our server. AI companies that work for us write the code. |
| consentSentTitle | What gets sent |
| consentSentRequest | What you ask for: your description, your answers and the plan you approve |
| consentSentEdit | When you change an app: its name, code and description, and the layout of its data, never the data itself |
| consentSentDevice | An ID Whim makes for this phone, used for daily limits and usage totals. |
| consentSentErrors | Error details when something goes wrong. They’re technical only, not what you typed or saved. |
| consentWhyTitle | Why |
| consentWhy | To build your apps and run Whim: daily limits, stopping abuse, keeping costs in check, and finding and fixing problems. |
| consentWhoTitle | Who gets it |
| consentWho | AnyCognition, the company that makes Whim, and companies that do work for us, like cloud hosting and AI providers. Some of them are outside Canada. They can’t train AI on it or use it for their own products, though some may keep it for a short time for security and legal reasons. |
| consentWhoPlatform | Apple or Google may also check that requests come from the real Whim app. |
| consentWhoAuthorities | We give information to authorities when the law requires it. |
| consentStaysTitle | What you save in your apps |
| consentStays | Nobody at Whim can read it. It stays on your phone, and anything Whim ever syncs or backs up for you is encrypted on your phone with a key Whim never has. |
| consentNeverTitle | What we never do |
| consentNever | Show ads, sell your data or share it for advertising, or track you across other apps and websites. |
| consentAskFirst | If we ever want to collect a new kind of information, use it for a new purpose, keep it longer, or give it to a new kind of company, we’ll ask you first. |
| consentFootnote | You can turn AI features and error details off in Settings. Apps you already have keep working either way. |

## What chain-3 changed in the web-site suite and page

- `server/test/web-site.suite.ts`: only the first red-check, re-pointed from the deleted `consentWhatSentDevice` to
  `consentSentDevice` ("dropping the phone-ID line fails naming consentSentDevice"). Allowlist and rule untouched.
- `deploy/site/privacy.html` (interim, so the gate stays green until chain-7): the v1 screen quotes under "What leaves
  your phone" … the Settings line were replaced by the table above, verbatim, as `<h2>`/`<p>`/`<li>`. Everything else on
  the page is still v1. Chain-7 replaces the file; the suite's other live constraints on the page stay: it must name
  OpenRouter, name no model vendor, and match `/deleted after (\d+) days/` and `/kept for (\d+) days/` to
  `loadServerConfig({})`'s report and ledger retention defaults.
