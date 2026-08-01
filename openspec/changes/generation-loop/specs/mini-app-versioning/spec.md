## ADDED Requirements

### Requirement: A snapshot carries the original source, not only the runnable bundle

Every snapshot a generation produces SHALL store the app's **original TypeScript source** as its own
artifact alongside the runnable bundle, so a later edit can re-send what the model actually wrote rather
than what the build emitted. Reading a snapshot's source SHALL return that artifact when present and
SHALL report its absence honestly for snapshots taken before source tracking existed — it SHALL NOT
silently substitute the compiled bundle. Existing installs SHALL keep working unchanged: an absent source
artifact is a legitimate state, never a migration or an error, and it resolves naturally the first time the
app is regenerated.

#### Scenario: A generated snapshot round-trips its source

- **WHEN** a generation is delivered and its snapshot's source is read back
- **THEN** the result is the original TypeScript the generation produced, not the bundle

#### Scenario: A legacy snapshot reports no source

- **WHEN** a snapshot taken before source tracking is read for its source
- **THEN** the absence is reported as such, and the compiled bundle is not returned in its place

#### Scenario: Legacy entries keep launching

- **WHEN** an app whose snapshots carry no source artifact is launched, restored, forked, and deleted
- **THEN** every operation behaves exactly as before, because the runnable bundle is unchanged
