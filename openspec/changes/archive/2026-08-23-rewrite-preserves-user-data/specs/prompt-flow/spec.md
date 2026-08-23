## ADDED Requirements

### Requirement: A rewrite for an edit carries the app it is changing

When the plan step opens for a re-prompt of an installed app, the device SHALL send that app's context with the rewrite request: its current display name and the display names of its collections and their fields, read from the entry's own stored record.

It SHALL send no app context when the flow is composing a new app. The context SHALL be assembled by a pure, Node-testable function outside the shell component, SHALL carry no source, no burned ids and no record contents, and SHALL be built through type-only contract imports so no zod value enters the Metro bundle graph. The plan step's user-visible copy, its rows, and its approval gate SHALL be unchanged.

#### Scenario: A re-prompt tells the rewrite what it is changing

- **WHEN** the user re-prompts an installed app called `Habit Tracker` whose schema declares a `Completions` collection
- **THEN** the rewrite request body carries `app.name` of `Habit Tracker` and `Completions` among `app.collections`

#### Scenario: Composing a new app sends no context

- **WHEN** the plan step opens from a compose step with no app being edited
- **THEN** the rewrite request body carries no `app` field

#### Scenario: Only names leave the device

- **WHEN** a re-prompt's rewrite request body is inspected
- **THEN** it contains display names only — no source, no bundle, no burned ids, no stored records
