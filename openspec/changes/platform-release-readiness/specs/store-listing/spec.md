## ADDED Requirements

### Requirement: Listing text lives as files within each store's limits
The App Store and Google Play listing text SHALL live under `release/store/app-store/` and `release/store/play/` in the directory layouts fastlane `deliver` and `supply` read, and the release checks SHALL fail when a required file is missing or a field exceeds its store limit.
Limits: App Store name 30 characters, subtitle 30, promotional text 170, description 4000, keywords 100 bytes, release notes 4000. Play title 30, short description 80, full description 4000, changelog 500. Each failure SHALL name the file, the limit and the actual length.

#### Scenario: An over-long subtitle
- **WHEN** `release/store/app-store/en-US/subtitle.txt` holds 31 characters
- **THEN** the release checks fail, naming the file, the 30-character limit and the length 31

### Requirement: No URL, domain or contact detail is committed in listing files
Files under `release/store/` SHALL NOT contain the release domain, any `whim.` URL, or reviewer contact details, and there SHALL be no URL files in the listing layouts.
The upload lanes SHALL pass the privacy policy and support URLs derived from `WHIM_DOMAIN` in the native release file, and SHALL read the review contact from `~/.config/whim/review-contact.json`.

#### Scenario: A committed support URL
- **WHEN** `release/store/app-store/en-US/support_url.txt` exists
- **THEN** the release checks fail, naming the file

#### Scenario: URLs follow the domain at upload
- **WHEN** the metadata lane runs with `WHIM_DOMAIN = anycognition.dev`
- **THEN** App Store Connect receives `https://whim.anycognition.dev/privacy` as the privacy policy URL and `https://whim.anycognition.dev/support` as the support URL

### Requirement: Privacy answers agree with each other, the manifest and the consent disclosure
The App Privacy answers (`release/store/app-store/app-privacy.json`), the Data safety answers (`release/store/play/data-safety.json`) and the iOS privacy manifest's collected data types SHALL name the same collected data: user content (the request, clarifying answers and approved plan; for an edit, the app's code, description and data layout; report text) and an anonymous device ID.
None SHALL claim tracking or linkage to identity. Data saved inside mini-apps SHALL be declared as not collected. The Data safety answers SHALL mark user content as shared with AI model providers for app functionality, both types as optional, and all data as encrypted in transit. The release checks SHALL fail on any disagreement, naming the files and the data type.

#### Scenario: The manifest drops a type
- **WHEN** `app-privacy.json` lists device ID and `PrivacyInfo.xcprivacy` doesn't
- **THEN** the release checks fail, naming both files and the device ID type

### Requirement: Listing copy is plain
Listing text files SHALL NOT use exclamation marks or any word on the validator's fixed list of promotional terms, and the release checks SHALL fail naming the file and the term.

#### Scenario: A promotional word
- **WHEN** the Play full description says the app is "revolutionary"
- **THEN** the release checks fail, naming the file and the word

### Requirement: Committed screenshots and age rating answers meet store rules
Committed App Store screenshots SHALL be portrait 1260×2736, 1290×2796 or 1320×2868. Committed Play phone screenshots SHALL be between 320 and 3840 pixels on each side, with the long side at most twice the short side.
The age rating answers SHALL be committed as `release/store/app-store/age-rating.json` and SHALL produce a 13+ rating.

#### Scenario: A tall Play screenshot
- **WHEN** a Play phone screenshot measures 1080×2400
- **THEN** the release checks fail, naming the file and its 2.22 aspect ratio
