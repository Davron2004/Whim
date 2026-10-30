## ADDED Requirements

### Requirement: The generation stream writes a frame as it opens
The generation server SHALL write a keepalive comment frame to a `POST /v1/generate` response as the stream opens, before the pipeline emits anything, whenever keepalives are enabled, and then every keepalive interval. The opening frame carries no event and no `id:`, so event ids still start at 1. A device therefore receives a first byte at once however long the pipeline's first step takes.

#### Scenario: A slow first step still opens with a byte
- **WHEN** the pipeline's first event arrives 20 seconds after the stream opens
- **THEN** the first chunk the client reads is the keepalive comment frame, the first event follows with `id: 1`, and keepalive frames arrive between them at the keepalive interval

#### Scenario: Keepalives disabled
- **WHEN** the keepalive interval is `0` or unset
- **THEN** no comment frame is written at open or after
