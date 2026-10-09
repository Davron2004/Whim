## ADDED Requirements

### Requirement: The home screen shows a quiet connectivity indicator
The home screen SHALL show a quiet status indicator reflecting the session's connectivity state
(unknown, checking, online, offline) sourced from `server-connectivity`. The indicator SHALL NOT
block or obscure the app grid, and MUST NOT appear when no server address is configured (state
unknown).

#### Scenario: Offline indicator appears without blocking the grid
- **WHEN** the connectivity state is offline
- **THEN** the home screen shows a quiet offline indicator, and the app grid remains fully
  visible and usable

#### Scenario: No indicator when unconfigured
- **WHEN** no server address has been configured
- **THEN** the home screen shows no connectivity indicator
