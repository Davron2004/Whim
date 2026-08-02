# handoff: chain-C — the v2 wire

Interface only. Source of record: `contract/src/index.ts` (zod schemas; static types via `z.infer`,
same name as the schema). Device code imports these **type-only** — zod must never enter the RN
bundle.

## Clarify — a pre-stream exchange, NOT a stage

```ts
Clarification   = { id: string; question: string; answer: string };
ClarifyQuestion = { id: string; question: string; options: string[] };  // options: min 1
ClarifyRequest  = { prompt: string };
ClarifyResponse = { questions: ClarifyQuestion[] };                     // max 3
```

`questions: []` is a **success**, meaning "nothing needs clarifying" — the common case. Four or more
questions fails to parse. `GenerationEvent` is untouched: no clarify event, no clarify stage.

### Route

| | |
|---|---|
| method/path | `POST /v1/clarify` |
| gate | `x-whim-device` UUID, by `/v1/*` prefix (missing/malformed → `400` before the handler) |
| `200` | `ClarifyResponse` JSON (`application/json`, never SSE) |
| `400` | `ApiError` `{ error: 'invalid_request', hint }` — body failed `ClarifyRequest` |
| `502` | `ApiError` `{ error: 'clarify_not_configured' \| 'model_failure', hint }` |

An unusable model answer is a `502`, never an empty question list — zero questions is a real answer,
not a degraded mode. **Devices should treat a clarify `502` as "skip to the plan step"**, not as a
dead end. Under `WHIM_PIPELINE=stub` the route is deterministic and makes no model call: three canned
questions, or zero when the prompt contains `[[noclarify]]`.

## Generate / rewrite

```ts
GenerateRequest.clarifications?: Clarification[];   // absent === [] === "answered nothing"
RewriteRequest.clarifications?:  Clarification[];   // same
PlanRow        = { label: string; text: string };
RewriteResponse = { rewrittenPrompt: string; plan?: PlanRow[] };
```

`plan` absent means "this server produced no structured breakdown" — the device renders
`rewrittenPrompt` as a single row. The server never emits `plan: []`; absent and empty mean the same
thing and it always sends the absent form. Row labels the rewrite model is asked for, in order:
`What it is`, `The screen`, `When a step ends`, `What it remembers` (exported as `PLAN_ROW_LABELS`
from `server/src/generation/prompts`). A rewrite model that answers in plain prose still conforms:
the prose becomes `rewrittenPrompt`, with no rows.

## The run summary — a field on `result`, never its own event

```ts
SummaryKind = 'Start' | 'Added' | 'Changed' | 'Removed' | 'Look' | 'Fixed';   // closed
SummaryMark = { cls: 'chg' | 'hedge'; start: number; end: number };
RunSummary  = { text: string; kind: SummaryKind; touched: string[]; marks: SummaryMark[] };

GenerationEvent  ⊃  { type: 'result'; app: WireAppRecord; summary?: RunSummary }
```

- `summary` is **optional**: the stub pipeline, a server whose summariser failed, and an older server
  all stay conforming. Absence is a legitimate state, never an emitter defect — never block on it.
- `start`/`end` are character offsets into the summary's **own `text`**, `end` exclusive.
- Producer budget (enforced in `server/src/generation/summarise.ts`, **not** in the schema): offsets
  in bounds, no two marks overlapping, at most one `chg` and one `hedge` per sentence. It is a
  budget, not a guarantee — the schema deliberately does not refine it, so a violating producer can
  never make a whole terminal event unparseable. **The renderer enforces its display caps itself.**
- The stream shape is unchanged: exactly one terminal event, last; a summary never arrives alone,
  never before the terminal, and never on a run that delivered no record.

## `tileColor` — inside the manifest, nowhere else

`AppSpec.tileColor?: string` (a `#rrggbb` **literal** in the `defineApp` argument) is lifted by the
one static extraction that already yields `capabilities` and rides to the device as:

```ts
WireAppRecord.manifest.tileColor?: string    // manifest stays an untyped record on the wire
```

There is **no** top-level `WireAppRecord.tileColor`. The server drops the declaration — silently, no
diagnostic — when it is not a string literal, not `#rrggbb`, or equal to a reserved hue
(`#0d9488`, `#2dd4bf`, `#b91c1c`, `#f87171`, `#c9c3b8`, `#3f3d8f`, `#a15c07`, `#e0a75e`, read from
`src/sdk/theme`, compared case-insensitively). A surviving value is passed through **verbatim**,
casing included. So the host sees either a usable colour or none: consumers fall back to
`appColor(name)` and never need to re-validate a hue the server already rejected.

## Shared error body

Every non-SSE `4xx`/`5xx` on `/v1/*` is `ApiError = { error: string; hint: string /* non-empty */ }`.
The device-identity `400` is its closed-enum specialization `DeviceIdError`
(`missing_device_id` | `invalid_device_id`).
