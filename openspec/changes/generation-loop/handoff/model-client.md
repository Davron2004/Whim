# Handoff: model-client-and-prompts (chain-2)

## `server/src/generation/model.ts` — the one LLM seam

```ts
interface ModelMessage { role: 'system' | 'user' | 'assistant'; content: string }
interface ModelRequest {
  model: string;              // resolved id — the CALLER picks it via ModelRoster, never the client
  messages: ModelMessage[];
  maxTokens?: number;
  temperature?: number;
}
interface ModelStream { deltas: AsyncIterable<string>; usage: Promise<Usage>; id: Promise<string | undefined> }
interface ModelClient { stream(req: ModelRequest, signal?: AbortSignal): ModelStream }

type ModelRole = 'rewrite' | 'engineer';
interface ModelRoster { rewrite: string; engineer: string }

function modelRosterFromEnv(env?: NodeJS.ProcessEnv): ModelRoster;
// Reads WHIM_REWRITE_MODEL / WHIM_ENGINEER_MODEL. Throws ModelRosterEnvError (.missing: string[])
// naming every unset variable — never falls back to a literal id.

function openRouterModelClient(client: OpenRouterClient): ModelClient;
// Thin pass-through: maps ModelRequest 1:1 onto OpenRouterOptions, forwards `signal`. Does NOT
// resolve a role to an id — callers build ModelRequest.model from a ModelRoster themselves.
```

`Usage` is `@whim/contract`'s `Usage`. No model id literal exists anywhere under
`server/src/generation/` — a `server/test/prompts.suite.ts` tripwire scans every string literal
there against a `vendor/model-id`-shaped pattern and fails the build if one appears.

## `server/test/scripted-model.ts` — the scripted-client protocol

```ts
interface ScriptedTurn {
  role: ModelRole;
  deltas: string[];
  usage?: Usage;               // defaults to zero usage
  id?: string;
  error?: unknown;             // thrown from the deltas iterator AND rejects `usage`, after `deltas` replay
}
interface CapturedRequest { role: ModelRole; request: ModelRequest }

class ScriptedModelClient implements ModelClient {
  constructor(roster: ModelRoster, turns: readonly ScriptedTurn[]);
  get requests(): readonly CapturedRequest[];   // every request received, in order
  stream(req: ModelRequest): ModelStream;
}
class ScriptedModelClientExhaustedError extends Error {}     // more calls than scripted turns
class ScriptedModelClientRoleMismatchError extends Error {}  // req.model didn't match the scripted role

const noNetworkTransport: FetchFn;  // throws synchronously on any fetch — install as OpenRouterClient's
                                     // transport in any suite that constructs a real client
```

Role resolution: `stream()` compares `req.model` against `roster.engineer`/`roster.rewrite` to infer
the actual role, and throws `ScriptedModelClientRoleMismatchError` if it doesn't match
`turns[cursor].role` — a caller that calls the wrong role fails loudly instead of silently consuming
the wrong fixture. `server/test/fixtures/model/{rewrite,engineer}-turn.json` are example recorded
turns (`{deltas, usage?, id?}`, no `role` — the caller supplies that when building a `ScriptedTurn`).

## `server/src/generation/prompts/inputs.ts` — the two disk-backed inputs

```ts
interface FewShotExample { name: string; source: string }
interface PromptInputs { sdkReference: string; fewShotExamples: FewShotExample[] }
class PromptInputError extends Error {}

function loadSdkReference(cwd?: string): string;
// docs/sdk-reference.md, overridable by WHIM_SDK_REFERENCE_PATH (relative paths resolve from cwd).
function loadFewShotExamples(cwd?: string): FewShotExample[];
// Every top-level fixtures/*.app.tsx (never fixtures/adversarial/**), excluding
// latency-probe.app.tsx, sorted by name. Both throw PromptInputError (actionable) if missing/empty.
function loadPromptInputs(cwd?: string): PromptInputs;  // both of the above
```

## `server/src/generation/prompts/index.ts` — message builders

`PromptPlan` mirrors design D11's `Plan` shape structurally (chain-4's `plan.ts` owns the validated
type; any object with this shape works here — no import dependency in either direction):

```ts
interface PromptPlan { screens: { name: string; purpose: string }[]; initial: string; state: string[];
  capabilities: string[]; storageKeys: string[] }

function buildRewriteMessages(ctx: { request: RewriteRequest }): ModelMessage[];
function buildPlanMessages(ctx: { request: GenerateRequest; schemaContext: string; priorFailureReason?: string }): ModelMessage[];
function buildGenerateMessages(ctx: { request: GenerateRequest; plan: PromptPlan; schemaContext: string }, inputs: PromptInputs): ModelMessage[];
function buildRepairMessages(ctx: { request: GenerateRequest; plan: PromptPlan; currentSource: string;
  diagnostics: Diagnostic[]; schemaContext: string }, inputs: PromptInputs): ModelMessage[];
```

`schemaContext` is opaque here — a pre-computed floor-description string (or `''`) the caller
supplies; these builders never read `GenerateRequest.app.appliedSchema` themselves. `diagnostics`
must already be errors-first ordered by the caller; `buildRepairMessages` renders them verbatim
(kind/severity/line/message/hint), in the given order. Every builder guarantees every returned
message's `content` is non-empty given a valid context (tripwire in `prompts.suite.ts`). The SDK
reference text and every few-shot example's source are embedded in generate/repair system messages
verbatim — no second copy exists anywhere else.

## Integration note for chain-7

`server/test/prompts.suite.ts` exports one entry point, `runPromptsTests(): Promise<void>` — wire it
into `acceptance.ts` like the other suites. It imports `typescript` (transitively, via
`checks/index.ts` and its own AST-based tripwires), which `server/test/run.mjs`'s esbuild step does
**not** currently mark `external` (unlike `checks/test/run.mjs`, which already does, for the same
reason: esbuild cannot inline `typescript`'s CJS bundle into ESM — "Dynamic require of fs"). Add
`external: ['typescript']` to the `build()` call in `server/test/run.mjs` when wiring this suite in,
or the bundle step will throw.
