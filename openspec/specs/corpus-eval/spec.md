# corpus-eval Specification

## Purpose
The three-tier, on-demand corpus-eval harness that makes generation quality measurable: a
deterministic Tier-A gate (static checks plus the synthetic-run boot/containment verdict), Tier-B
English-first behavioral assertions carried as inert data over a closed vocabulary, and a
non-gating Tier-C rubric judge. Its CLI composes eval-set loading, candidate sourcing,
run/diff/compare, and canonical reports whose redaction is keyed off the set's declared
visibility. The eval set is always supplied at run time (`--eval-set` / `WHIM_EVAL_SET`), never
embedded, and no holdout location is ever recorded in this repo.

## Requirements

### Requirement: The eval set is supplied at run time and never embedded

The runner SHALL resolve the eval set it evaluates from an explicit run-time location: the `--eval-set <path>`
argument, or the `WHIM_EVAL_SET` environment variable when the argument is absent. The argument SHALL win over
the environment variable. The runner SHALL NOT carry a built-in default eval-set location, SHALL NOT fall back
to any path inside the repository when no location is supplied, and SHALL NOT retrieve eval content over the
network. The committed visible set under `evals/sets/visible/` is addressable only by the operator passing its
path explicitly, exactly like any other set.

#### Scenario: No location supplied

- **WHEN** the runner is invoked with neither `--eval-set` nor `WHIM_EVAL_SET`
- **THEN** it evaluates nothing, exits with a non-zero status, and prints a message naming both the flag and
  the environment variable

#### Scenario: Flag overrides environment

- **WHEN** `--eval-set A` is passed while `WHIM_EVAL_SET` is set to `B`
- **THEN** the set at `A` is loaded and the report records `A` as the resolved location

#### Scenario: Location points at no readable set

- **WHEN** the supplied location does not exist, or exists without a readable manifest
- **THEN** the runner exits non-zero naming the resolved location and the specific defect, and evaluates no
  cases

#### Scenario: No network retrieval of eval content

- **WHEN** the runner loads any eval set
- **THEN** every case, prompt, and expectation comes from the resolved local location, and the loader performs
  no network request

### Requirement: Holdout content never enters the repository or a report

An eval set SHALL declare a `visibility` of `visible` or `holdout`. For a set declaring `holdout`, every
artifact the runner produces — run report, Markdown summary, diff output, compare output, and console output —
SHALL identify cases by case id and a SHA-256 digest of the prompt only, and SHALL NOT contain prompt text,
expectation prose, or generated candidate source. Redaction SHALL be applied where the report is constructed,
so no downstream consumer can produce an unredacted holdout artifact.

#### Scenario: Holdout report carries no prompt text

- **WHEN** a run over a set declaring `visibility: holdout` completes
- **THEN** no prompt string or expectation string from that set appears anywhere in the emitted report or
  summary, and each case carries its id plus a `promptSha256` field

#### Scenario: Redaction survives diff and compare

- **WHEN** two holdout reports are passed to `diff`, or a visible and a holdout report to `compare`
- **THEN** the output names cases by id only and contains no prompt or expectation text from the holdout set

#### Scenario: Reports are not written into tracked source by default

- **WHEN** the runner writes a report with no `--out` argument
- **THEN** it writes under the git-ignored default output directory, and never overwrites a tracked file

### Requirement: Three tiers with declared gating semantics

The runner SHALL evaluate each case in three tiers. Tier A is a deterministic gate; Tier B is a set of
behavioral assertions; Tier C is a rubric judgement. A Tier-A failure SHALL short-circuit the case: Tiers B
and C are not evaluated and are recorded as skipped with the reason `tier_a_failed`. A Tier-B failure SHALL
NOT prevent Tier C from being evaluated. A case's overall verdict SHALL be `pass` if and only if Tier A passed
and every required Tier-B assertion passed; Tier C SHALL never contribute to the pass/fail verdict.

#### Scenario: Tier A failure short-circuits

- **WHEN** a candidate fails Tier A
- **THEN** the case verdict is `fail`, and the case's Tier-B and Tier-C results are each recorded as
  `skipped` with reason `tier_a_failed`

#### Scenario: Tier B failure does not suppress Tier C

- **WHEN** a candidate passes Tier A and fails one required Tier-B assertion, with a judge configured
- **THEN** the case verdict is `fail` and the Tier-C result is still present with its rubric scores

#### Scenario: Tier C never gates

- **WHEN** a candidate passes Tier A and every required Tier-B assertion but receives the lowest possible
  score on every rubric criterion
- **THEN** the case verdict is `pass`, and the low Tier-C scores are recorded in the report

### Requirement: Tier A is deterministic and trusts only authenticated vantages

Tier A SHALL combine the static leg — `runStaticChecks` over the candidate source — with the runtime leg —
the boot and containment outcome from the synthetic-run harness. Any diagnostic of `error` severity SHALL
fail Tier A. A containment verdict SHALL be accepted only from a nonce-authenticated observation vantage; a
verdict self-reported by the candidate bundle SHALL be ignored. Given the same candidate source and the same
harness inputs, Tier A SHALL produce an identical result.

#### Scenario: Same input, same result

- **WHEN** Tier A is evaluated twice over the same candidate source and the same run observation
- **THEN** the two Tier-A results are equal field for field

#### Scenario: Error diagnostic fails Tier A

- **WHEN** the static leg returns any diagnostic of `error` severity
- **THEN** Tier A fails and the report carries that diagnostic's kind, message, and fix hint

#### Scenario: Self-reported verdict is not trusted

- **WHEN** a run observation carries a containment verdict that did not originate from the authenticated
  vantage
- **THEN** Tier A does not treat it as a pass, and records the case as an untrusted-verdict failure

#### Scenario: One adapter owns the harness shape

- **WHEN** the synthetic-run harness report is consumed
- **THEN** it is normalized into the runner's `RunObservation` by the single adapter module, and no tier
  evaluator reads harness-specific field names directly

### Requirement: Tier-B specs are English-first and encoded as inert data

Every Tier-B spec SHALL carry a non-empty English statement of the behavior it asserts, alongside an encoded
assertion drawn from the closed `ASSERTION_KINDS` vocabulary. The loader SHALL reject a spec missing its
English statement and a spec naming an assertion kind outside the vocabulary. Assertions SHALL be pure data;
the runner SHALL NOT evaluate, compile, import, or otherwise execute any code supplied inside an eval set.

#### Scenario: Missing English statement is a load error

- **WHEN** a Tier-B spec supplies an encoded assertion with no English statement
- **THEN** the eval set fails to load, naming the offending case id, and no case is evaluated

#### Scenario: Unknown assertion kind is a load error

- **WHEN** a Tier-B spec names an assertion kind not in `ASSERTION_KINDS`
- **THEN** the eval set fails to load, naming the offending kind and the closed set of accepted kinds

#### Scenario: Eval-set-supplied code is refused, never run

- **WHEN** an eval set supplies an assertion expressed as a code string or a module reference
- **THEN** the loader rejects it as an unsupported assertion shape and the runner never evaluates or imports it

#### Scenario: The English statement reaches the report

- **WHEN** a Tier-B assertion fails
- **THEN** the report entry for that assertion carries its English statement verbatim together with the
  observed value that contradicted it

### Requirement: Tier-B assertions evaluate against the normalized run observation

Tier-B assertions SHALL be evaluated only against the `RunObservation` — the normalized view of the
synthetic-run report covering diagnostics, declared and reached screens, the syscall and cue invocation trace,
and the containment verdict. Each assertion result SHALL record pass or fail together with the concrete
observed value, never a bare boolean.

#### Scenario: Unreachable declared screen fails its assertion

- **WHEN** a `screen-reachable` assertion names a screen the run observation lists as declared but never
  reached
- **THEN** the assertion fails and the result names that screen and lists the screens actually reached

#### Scenario: Syscall assertion reads the recorded trace

- **WHEN** a `syscall-invoked` assertion names a capability the observation's invocation trace does not contain
- **THEN** the assertion fails and the result lists the invocations actually recorded

### Requirement: The Tier-C judge is injected and the gate never calls a live model

Tier C SHALL score a candidate through an injected `Judge` interface. The runner SHALL provide a scripted
judge and a recorded-transcript replay judge, both fully offline. A live model-backed judge SHALL be
constructible only when an explicit opt-in argument and the required credential environment variable are both
present; absent either, construction SHALL fail rather than silently degrade. The acceptance suite SHALL use
only offline judges and SHALL make no network request.

#### Scenario: Acceptance suite is offline

- **WHEN** the runner's own acceptance suite executes
- **THEN** every Tier-C assertion runs against a scripted or replay judge and no live model client is
  constructed

#### Scenario: Live judge requires explicit opt-in

- **WHEN** a live judge is requested without the opt-in argument, or with the argument but no credential in
  the environment
- **THEN** construction fails with a message naming what is missing, and the run does not proceed with a
  silently substituted judge

#### Scenario: No judge configured

- **WHEN** a run is invoked with no judge configured at all
- **THEN** Tiers A and B are evaluated normally and each Tier-C result is recorded as `skipped` with reason
  `no_judge_configured`

#### Scenario: Malformed verdict is an error, not a pass

- **WHEN** a judge returns a verdict missing a rubric criterion, missing a rationale, or carrying a score
  outside the rubric's range
- **THEN** the Tier-C result for that case is recorded as `error` naming the defect, and is never recorded as
  a passing score

### Requirement: The rubric is versioned and recorded with every judgement

The Tier-C rubric SHALL be a committed English document with an explicit version identifier and a closed list
of scored criteria. Every Tier-C result SHALL record the rubric version and the judge identity that produced
it. A change to the rubric text without a version bump SHALL be detected.

#### Scenario: Rubric identity travels with the score

- **WHEN** any Tier-C result is written into a report
- **THEN** it carries the rubric version and the judge identity alongside the per-criterion scores and
  rationales

#### Scenario: Rubric edited without a version bump

- **WHEN** the rubric document's scored content changes while its version identifier stays the same
- **THEN** the acceptance suite fails, naming the rubric version that must be bumped

### Requirement: Run reports are canonical and diffable

A run report SHALL be emitted as canonical JSON with deterministic ordering: cases sorted by case id,
assertions in declared order, and object keys in a stable order. Measured durations and wall-clock timestamps
SHALL live in a section explicitly excluded from the diffable body, so that two runs over identical inputs
produce a byte-identical diffable body. Every report SHALL record its schema version, the resolved eval-set
identity and visibility, the runner version, and the label identifying what produced the candidates. The
runner SHALL provide a `diff` operation over two reports that names per-case, per-tier regressions.

#### Scenario: Identical inputs produce an identical body

- **WHEN** the same eval set is run twice over the same candidate sources with the same offline judge
- **THEN** the diffable bodies of the two reports are byte-identical, while their timing sections may differ

#### Scenario: Diff names regressions

- **WHEN** `diff` compares a report where a case passed Tier B against one where the same case failed it
- **THEN** the output lists that case id, the tier, and the specific assertion that regressed

#### Scenario: Provenance is recorded

- **WHEN** any report is emitted
- **THEN** it carries the schema version, eval-set id, eval-set visibility, runner version, rubric version
  when Tier C ran, and the candidate-producer label

### Requirement: Visible-versus-holdout divergence raises an overfitting alarm

The runner SHALL provide a `compare` operation taking a visible-set report and a holdout-set report and
reporting per-tier pass-rate divergence. When the holdout pass rate falls below the visible pass rate by more
than the configured threshold, the output SHALL carry an `overfitting_alarm` and `compare` SHALL exit
non-zero. `compare` SHALL refuse reports whose schema versions differ, or whose rubric versions differ when
Tier C is being compared.

#### Scenario: Divergence beyond threshold alarms

- **WHEN** the holdout report's Tier-A+B pass rate is lower than the visible report's by more than the
  threshold
- **THEN** the output carries `overfitting_alarm` naming the tier and the two rates, and the command exits
  non-zero

#### Scenario: Divergence within threshold is quiet

- **WHEN** the two pass rates differ by no more than the threshold
- **THEN** no alarm is raised and the command exits zero

#### Scenario: Mismatched report versions are refused

- **WHEN** the two reports carry different schema versions, or different rubric versions while Tier C is
  compared
- **THEN** `compare` refuses, names the mismatch, and produces no divergence number

### Requirement: Candidate sourcing is offline-capable and consumes exactly one terminal event

The runner SHALL obtain each case's candidate source either from a supplied directory mapping case id to a
source file, with no generation performed, or from an injected generation pipeline. When driving a pipeline,
the runner SHALL treat a completed stream carrying anything other than exactly one terminal event as a runner
error rather than a candidate failure.

#### Scenario: Fully offline sourcing

- **WHEN** the runner is given a source directory covering every case id in the set
- **THEN** every candidate is read from disk, no pipeline is constructed, and no model is contacted

#### Scenario: Missing candidate source

- **WHEN** the supplied source directory has no file for a case id in the set
- **THEN** that case is recorded as `error` naming the missing case id, and the remaining cases still run

#### Scenario: Exactly one terminal event

- **WHEN** a generation stream for a case completes carrying two terminal events, or none
- **THEN** the runner records a runner-level error for that case naming the violation, and does not record a
  candidate verdict derived from that stream

### Requirement: Corpus apps have stable slugs bound to the corpus document

Each Tier-0 corpus app SHALL have a stable slug in the runner's corpus registry, and every eval case SHALL
reference its app by that slug. The registry and the corpus document SHALL be kept in agreement.

#### Scenario: Unknown slug is a load error

- **WHEN** an eval case references an app slug absent from the registry
- **THEN** the eval set fails to load, naming the unknown slug

#### Scenario: Registry and corpus document must agree

- **WHEN** the corpus document's Tier-0 slugs and the registry's slugs differ in either direction
- **THEN** the acceptance suite fails, naming the slugs present on only one side

### Requirement: Eval runs are on demand and never part of the automated gate

The automated gate SHALL run only the runner's own acceptance suite, never a corpus eval run: eval runs cost
model spend and browser time and require an operator-supplied eval set.

#### Scenario: Gate configuration invokes no eval run

- **WHEN** the acceptance suite inspects the gate configuration
- **THEN** it finds the runner's acceptance-suite entry and no invocation of the corpus-eval run command, and
  fails if one is present

#### Scenario: Acceptance suite needs no eval set

- **WHEN** the acceptance suite executes with neither `--eval-set` nor `WHIM_EVAL_SET` set
- **THEN** it passes, exercising the runner against its own committed fixtures
