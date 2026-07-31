## ADDED Requirements

### Requirement: The create affordance and per-app re-prompt action open the prompt flow
The home screen's "make your first app" affordance SHALL open the prompt flow's new-app entry point. The app long-press action sheet SHALL include a "Prompt again" action alongside Open/Fork/Delete/History, opening the prompt flow's edit entry point scoped to that app.

#### Scenario: Create tile opens the prompt flow
- **WHEN** the user taps the "make your first app" tile
- **THEN** the prompt screen opens with no app being edited

#### Scenario: Re-prompt opens the prompt flow scoped to an app
- **WHEN** the user long-presses an app tile and chooses "Prompt again"
- **THEN** the prompt screen opens scoped to that app

### Requirement: Version-store access for the prompt flow's delivery stays behind StoreAccess
The launcher SHALL deliver a generated app (install a new entry, snapshot an existing entry's own lineage, or fork a silent shared continuation) exclusively through `StoreAccess` wrapper methods; no launcher component may hold or call a raw `VersionStore` handle. Each wrapper SHALL apply the existing ensure-lineage discipline.

#### Scenario: Delivery only through StoreAccess
- **WHEN** the prompt flow installs, updates, or forks-and-updates an entry after a successful generation
- **THEN** every store interaction goes through a `StoreAccess` method that ensures the entry's lineage first

### Requirement: The Settings screen persists a server address for the prompt flow
The launcher SHALL let the user enter and persist a server address, used by the prompt flow's rewrite and generation requests. An absent or invalid address SHALL be treated as "not configured" rather than causing a crash, and the prompt flow SHALL show an honest message directing the user to Settings rather than attempting a request.

#### Scenario: Configured address is used
- **WHEN** a server address has been entered in Settings and the user submits a prompt
- **THEN** the rewrite and generation requests target that address

#### Scenario: Unconfigured address is handled honestly
- **WHEN** no server address has been entered and the user opens the prompt screen
- **THEN** the screen tells the user to set an address in Settings instead of attempting a request
