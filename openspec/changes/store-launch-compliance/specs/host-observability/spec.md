## MODIFIED Requirements

### Requirement: Sensitive fields are structurally unloggable on the device
The seam SHALL make the repo's privacy floor a property of the code path rather than a convention:
prompt text, generated mini-app source, report note text, the `x-whim-device` value, and any
model-provider API key SHALL NOT appear in any emitted record, in the ring buffer, or in anything a
sink receives. A record whose structured fields carry a sensitive key SHALL have that value replaced
with a fixed redaction marker before the record is buffered, so redaction cannot be lost by a sink
that serializes differently from another.

#### Scenario: A sensitive field is redacted at the seam
- **WHEN** a caller passes a field named for prompt text, report note text, device id, or an API key
- **THEN** the buffered record carries the redaction marker in that field's place, and the
  original value appears in no sink

#### Scenario: Redaction is not sink-dependent
- **WHEN** the same record is read by the overlay and by the batching sink
- **THEN** both observe the redacted value
