# Delta Spec: app-launcher

## ADDED Requirements

### Requirement: History entry point in the app action sheet
The app long-press action sheet SHALL include a History action alongside Open/Fork/Delete, opening the app's full-screen history surface. The history screen SHALL follow the launcher's full-screen sibling pattern: its own hardware-back binding returning to Home, theme colors via the shell palette, and all strings via the centralized copy table (product-verbs guard applies).

#### Scenario: Opening history
- **WHEN** the user long-presses an app tile and chooses History
- **THEN** the app's history screen opens full-screen, and hardware back returns to Home

### Requirement: Version-store access for history flows stays behind StoreAccess
The launcher SHALL reach all history-related store verbs (history/timeline listing, restore, pin, diff, fork-from-version) exclusively through `StoreAccess` wrapper methods; no launcher component may hold or call a raw `VersionStore` handle. Each wrapper SHALL apply the existing ensure-lineage discipline before delegating, so fork entries (whose store id and lineage differ from their launcher id) resolve correctly. Fork SHALL accept an optional version so "make this version its own app" reuses the existing fork→install flow unchanged.

#### Scenario: Wrappers only
- **WHEN** the history screen lists, restores, pins, diffs, or forks
- **THEN** every store interaction goes through a `StoreAccess` method that ensures the entry's lineage first

#### Scenario: Fork entry history
- **WHEN** History is opened on a forked app entry
- **THEN** the listed versions are those of the fork's own lineage line, not the original's
