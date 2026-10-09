## MODIFIED Requirements

### Requirement: History reads as the user's own prompts
The history screen SHALL present an app's versions as a newest-first timeline. Its header SHALL name the app in that app's own tile hue followed by `history`, over a subtitle counting the versions and naming when the app started.

Each collapsed row SHALL carry a kind badge, a human-readable timestamp, the version identifier, an origin line reading `You said` when the user's prompt caused the version and `Whim, on its own` when the product acted unprompted, and a headline. Under `You said` the headline SHALL quote the user's own words, the version's prompt text, parsing the prompt envelope (any version of it) when present and falling back to the raw stored string when it is not; it SHALL NOT be the stored summary, which the row's expanded body shows instead. Under `Whim, on its own`, where there are no words of the user's to quote, the headline SHALL be the stored summary's text. Headlines SHALL be rendered through the shared Whim Syntax renderer, so the user's own words carry the `yours` class and mentions of an app carry its hue.

The version the user is currently on SHALL be marked `↑ you're on this one` beneath its row, derived live from the store and never persisted on the app record. Version-control vocabulary SHALL never appear; every user-visible string SHALL come from the centralized copy table and pass the product-verbs guard.

#### Scenario: Summarised rows
- **WHEN** the user opens History for an app whose versions carry stored summaries
- **THEN** each row shows `You said` over that version's own prompt, quoted, as its headline, with its kind badge, timestamp and version identifier, newest first, and no row shows its summary until it is expanded

#### Scenario: A version with no summary still shows its prompt
- **WHEN** a version was delivered before summaries existed, or its run produced none
- **THEN** the row shows that version's prompt text as its headline and the screen does not error

#### Scenario: Raw legacy prompt string
- **WHEN** a version's stored prompt is not valid envelope JSON (e.g. a seeded fixture)
- **THEN** the row shows the raw string unchanged and the screen does not error

#### Scenario: Install row
- **WHEN** the list reaches the app's first version (the install event)
- **THEN** the row shows install-appropriate copy, and offers no restore action (there is no earlier state)

#### Scenario: Current version is marked
- **WHEN** the list renders after a restore
- **THEN** `↑ you're on this one` appears beneath the now-active version's row and beneath no other
