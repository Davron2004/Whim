# hardening-research-discipline Specification

## Purpose
What a hardening or security change's research must contain so an existing occurrence of the vulnerable pattern is classified rather than copied: a census of every occurrence, and a filed backlog entry for each UNSAFE one the change does not fix.
## Requirements
### Requirement: A hardening change's research artifact carries a full pattern census

A hardening change's `research.md` SHALL include a pattern census enumerating every in-repo occurrence of the pattern under investigation, classifying each row SAFE, UNSAFE, or NOT-CHECKED, and naming the test applied to reach that classification. Citing an in-repo occurrence of the investigated pattern as a design exemplar, without a census row classifying it, SHALL NOT be treated as adequate research — every occurrence of the pattern under investigation is a suspect until classified, never evidence by precedent.

#### Scenario: Research cites the pattern without a census row

- **WHEN** a hardening change's `research.md` references an in-repo occurrence of the investigated pattern as precedent, but the file contains no census row classifying that occurrence
- **THEN** the research artifact is incomplete for that change

#### Scenario: Every occurrence is accounted for

- **WHEN** a hardening change's `research.md` is complete
- **THEN** every in-repo occurrence of the investigated pattern appears in the census with a SAFE, UNSAFE, or NOT-CHECKED classification and the test applied named

### Requirement: An out-of-scope UNSAFE finding is filed as a GitHub issue before closure

A pattern-census row classified UNSAFE that falls outside the current change's declared scope SHALL be filed as a GitHub issue labelled `ai-proposed` (title = vulnerability class + `file:line`; body = what done looks like), with the finding's file:line and vulnerability class, before the change closes. A mention of the finding in a run's report or progress notes SHALL NOT satisfy this requirement, because prose is not a durable sink and leaves the finding dependent on a human hand-carrying it into a future run rather than a future run discovering it on its own.

#### Scenario: An UNSAFE row is out of scope

- **WHEN** a hardening change's census classifies a row UNSAFE and that row's fix is outside the change's declared scope
- **THEN** an `ai-proposed` GitHub issue naming its file:line and vulnerability class exists before the change closes

#### Scenario: Reported but not ledgered is insufficient

- **WHEN** an UNSAFE out-of-scope finding is described only in a run's report or progress notes and not filed as an `ai-proposed` GitHub issue
- **THEN** the requirement is not satisfied

