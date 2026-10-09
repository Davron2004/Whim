## ADDED Requirements

### Requirement: Legal text is French first on a French-language phone, with an express choice of English
The launcher SHALL resolve an active legal language, French or English. A choice the user made SHALL win, and SHALL be persisted under `whim.legal-language:v1`. Without a choice, the language SHALL be French when the device's preferred language is French (any region), and English otherwise. The terms step, the consent screen (including the outdated and what's-new lines), and the links they and Settings open SHALL use the active legal language. The terms step and the consent screen SHALL each offer a one-tap switch to the other language, and taking it SHALL persist the choice. The rest of the app MAY stay English.

#### Scenario: A fr-CA phone sees French first
- **WHEN** a user whose phone's preferred language is fr-CA takes their first data-sending action
- **THEN** the terms step and then the consent screen render in French, each with a "Continue in English" switch

#### Scenario: Choosing English is remembered
- **WHEN** that user taps "Continue in English" and later opens the consent screen from Settings
- **THEN** the consent screen renders in English and its privacy link opens `/privacy`

#### Scenario: An English phone sees English
- **WHEN** a user whose phone's preferred language is en-US takes their first data-sending action
- **THEN** the terms step renders in English with a "Continuer en français" switch

### Requirement: Every legal copy key exists in both languages
Every copy key that the terms step, the consent screen or the what's-new line uses SHALL exist and be non-empty in both the English and French tables. The gate SHALL fail when one is missing. A translation SHALL count as a wording change and SHALL NOT move the consent version.

#### Scenario: A missing French key fails the gate
- **WHEN** a new consent key is added to the English table only
- **THEN** the gate fails, naming the key and the French table
