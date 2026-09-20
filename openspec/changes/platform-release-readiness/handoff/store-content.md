# store-content (chain-8 → chain-9, chain-10, chain-11)

## Files this chain owns

`release/store/app-store/en-US/{name,subtitle,description,keywords,promotional_text}.txt`,
`release/store/app-store/{copyright,primary_category,secondary_category}.txt`,
`release/store/app-store/{app-privacy.json,age-rating.json}`,
`release/store/play/en-US/{title,short_description,full_description}.txt`,
`release/store/play/en-US/changelogs/default.txt`, `release/store/play/data-safety.json`,
`release/store/answers.md`, `scripts/release/lib/store-listing.ts`,
`checks/test/release/store-listing.suite.ts`. No `release_notes.txt` yet (first submission needs
none; chain-11 adds `review_information/notes.txt` and may add a notes-length limit — task 12,
D16 — to `LISTING_LIMITS` without renaming it). No screenshots are committed yet; chain-13
(attended) adds them under the two directories below.

## `scripts/release/lib/store-listing.ts`

```ts
export interface StoreListingFinding {
  readonly file: string; // repo-relative; comma-joined for a cross-file privacy disagreement
  readonly message: string;
}
export type ListingLimitUnit = 'characters' | 'bytes';
export interface ListingFieldLimit { readonly file: string; readonly limit: number; readonly unit: ListingLimitUnit; }

export const LISTING_LIMITS: readonly ListingFieldLimit[] = [
  { file: 'release/store/app-store/en-US/name.txt', limit: 30, unit: 'characters' },
  { file: 'release/store/app-store/en-US/subtitle.txt', limit: 30, unit: 'characters' },
  { file: 'release/store/app-store/en-US/promotional_text.txt', limit: 170, unit: 'characters' },
  { file: 'release/store/app-store/en-US/description.txt', limit: 4000, unit: 'characters' },
  { file: 'release/store/app-store/en-US/keywords.txt', limit: 100, unit: 'bytes' },
  { file: 'release/store/play/en-US/title.txt', limit: 30, unit: 'characters' },
  { file: 'release/store/play/en-US/short_description.txt', limit: 80, unit: 'characters' },
  { file: 'release/store/play/en-US/full_description.txt', limit: 4000, unit: 'characters' },
  { file: 'release/store/play/en-US/changelogs/default.txt', limit: 500, unit: 'characters' },
];
export const REQUIRED_LISTING_FILES: readonly string[]; // the same-family files with no length limit — see the file above

export const PROMO_TERMS: readonly string[] = [
  'amazing','awesome','best-in-class','breakthrough','cutting-edge','effortless','game-changing',
  'incredible','magical','powerful','revolutionary','seamless','stunning','ultimate','unleash','world-class',
];

export interface PrivacyTypeMapping {
  readonly appPrivacyCategory: string; readonly manifestType: string; readonly dataSafetyId: string; readonly label: string;
}
export const PRIVACY_TYPE_MAPPING: readonly PrivacyTypeMapping[]; // exactly the two rows below

export function checkStoreListing(repoRoot: string, config: NativeReleaseConfig): StoreListingFinding[]; // empty = passes
```

`checkStoreListing` composes: required-file + length-limit checks (`LISTING_LIMITS` +
`REQUIRED_LISTING_FILES`); no filename matching `/url/i` and no content match on
`config.WHIM_DOMAIN` or `/whim\.[a-z0-9]/i` under `release/store/**` (`.txt`/`.json`/`.md`); no
`!` and no `PROMO_TERMS` word in any `.txt`/`.md` under `release/store/**`; App Store screenshots
under `release/store/app-store/screenshots/**` must be exactly 1260×2736, 1290×2796 or
1320×2868; Play screenshots under `release/store/play/en-US/images/phoneScreenshots/**` must
have each side in [320, 3840] with long:short ≤ 2 (finding names the file and the ratio,
`toFixed(2)`); `release/store/app-store/age-rating.json`'s `ageRatingOverrideV2` must be exactly
`"THIRTEEN_PLUS"`; and the privacy mapping below must agree across all three files, with no
`data_protections` entry claiming `DATA_LINKED_TO_YOU`. PNG/JPEG dimensions are read by a
from-scratch header parser (no dependency) — `preflight.ts`'s `checkAssets` can reuse the same
approach for icon/launch-mark dimensions if it needs one, but does not import from this file.

Reads (does not own): `ios/Whim/PrivacyInfo.xcprivacy` via `parseXmlPlist` from `./ios-project`.

## Privacy mapping (design D11) — verbatim, closed set of two

| App Privacy `category` | `PrivacyInfo.xcprivacy` type | Data safety `id` | label |
|---|---|---|---|
| `OTHER_USER_CONTENT` | `NSPrivacyCollectedDataTypeOtherUserContent` | `other_user_generated_content` | user content |
| `DEVICE_ID` | `NSPrivacyCollectedDataTypeDeviceID` | `device_or_other_ids` | device ID |

Any other `category` in `app-privacy.json` is itself a finding (data saved inside mini-apps must
never be declared collected).

## JSON schemas (this chain's own — no other chain edits these files)

`app-privacy.json`: `{ category: string; purposes: string[]; data_protections: string[] }[]`.
Both entries here use `purposes: ["APP_FUNCTIONALITY"]`, `data_protections:
["DATA_NOT_LINKED_TO_YOU"]`.

`data-safety.json`: `{ encryptedInTransit: boolean; deletionRequestMechanism: string; types: {
id: string; collected: boolean; shared: boolean; sharedWith?: string; optional: boolean;
ephemeral: boolean; purposes: string[] }[] }`. `other_user_generated_content` is `shared: true`,
`sharedWith: "AI model providers through OpenRouter"`. `device_or_other_ids` is `shared: false`.
Both are `optional: true`, `ephemeral: false`.

`age-rating.json`: `{ ageRatingOverrideV2: "THIRTEEN_PLUS"; contentDescriptors: Record<string,
"NONE">; unrestrictedWebAccess: false; gambling: false }`. Attribute names follow the App Store
Connect `AgeRatingDeclaration` resource (design D11); the attended metadata upload confirms them.

## Owner decisions baked into the committed copy (do not re-litigate)

App Store name / Play title: `Whim: Small Apps You Describe` (29 chars). Subtitle: `No coding.
Just talk.` (chosen to share no word with the name). Copyright: `2026 AnyCognition Inc.`.
Categories: `PRODUCTIVITY` / `UTILITIES`. `release/store/answers.md` records availability (all
territories except mainland China, missing generative-AI filing), 13+ target audience, the
AI-generated-content declaration, and the Device and Network Abuse exemption, each with its
source line.
