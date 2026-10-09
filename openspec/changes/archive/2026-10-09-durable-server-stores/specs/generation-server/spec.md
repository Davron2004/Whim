## MODIFIED Requirements

### Requirement: Server state is the usage store and user-sent reports
The server SHALL keep its generation state in exactly two durable stores, in the backend the operator selects (`server-storage-backends`): `node:sqlite` databases under a gitignored `WHIM_DATA_DIR` (default `server/.data/`; `:memory:` in tests), opened in WAL mode so an operator command can read them while the server writes, or Firestore.

The first is the **usage store**. It holds the per-device token counter (`UsageStore`) and the content-free request ledger defined by `server-admission-control`. Every generation, stub included, SHALL credit its usage through this store, and the totals SHALL survive a server restart.

The second is the **report store** defined by `content-reports`. It holds only reports a user explicitly sent, for the configured retention period.

The beta waitlist store (`beta-waitlist`) lives in the same backend and holds only website signups; it never sees app traffic. No other server-side persistence of any kind SHALL exist. Outside the report store, prompts, clarifications, source, bundles, manifests, schemas, and app content are never stored (§4.7 Model 1, with the reports exception recorded in `docs/decisions.md`).

#### Scenario: Stub generation meters real state
- **WHEN** a device runs two stub generations and the server restarts
- **THEN** the device's accumulated token total equals the sum of both runs' `usage` events

#### Scenario: Nothing but the two stores persists
- **WHEN** the SQLite data directory is inspected after clarify, rewrite, generate, and report requests carrying distinctive marker text
- **THEN** it contains only the usage and report databases (with their SQLite sidecar files), the marker text appears only in the report database and only for the report request, and the usage database holds counters and ledger rows only
