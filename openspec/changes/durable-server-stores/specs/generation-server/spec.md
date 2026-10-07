## MODIFIED Requirements

### Requirement: Token metering — the only server state
The server SHALL keep one durable per-device-ID token counter behind the `UsageStore` interface, in the backend the operator selects (`server-storage-backends`): `node:sqlite` under a gitignored `WHIM_DATA_DIR` (default `server/.data/`; `:memory:` in tests) or Firestore. Every generation, stub included, SHALL credit its usage through this store, and the totals SHALL survive a server restart. No other server-side persistence of any kind SHALL exist (§4.7 Model 1: prompts, source, and bundles are never stored).

#### Scenario: Stub generation meters real state
- **WHEN** a device runs two stub generations and the server restarts
- **THEN** the device's accumulated token total equals the sum of both runs' `usage` events

#### Scenario: Nothing but the counter persists
- **WHEN** the data directory is inspected after a generation
- **THEN** it contains device-ID→counter rows only — no prompt, source, bundle, or app
  content anywhere
