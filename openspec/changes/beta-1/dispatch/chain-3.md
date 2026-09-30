# chain-3 dispatch block: server-generation-quality (tasks 3.1–3.5)

Tasks 3.1–3.5 verbatim from tasks.md (the dispatch prompt quotes them).

Read (only these):
- `specs/generation-pipeline/spec.md`: "Clarify and plan writing stay inside what a mini-app can do", "Clarify
  picks each question's answer mode…", "A model turn that loses its provider is retried once", "An unverified or
  failed containment verdict is logged without content", "A no-change summary requires unchanged source". (Not
  the quantization requirement: chain-2 did it.)
- `specs/content-policy/spec.md` (one requirement).
- `design.md` §D9, §D10, §D11, §D13, §D18.
- `research.md` §"Current behavior": the #57, #58 and #106 bullets; §"Constraints and invariants": closed
  `TERMINAL_FAILURE_CODES`, "the summariser is record-free and side-effect-free", "model ids come only from env".
- `handoff/wire-protocol.md` §Server (registry/emitter, the call-site rule) and §"Clarify interim (chain 3
  replaces)".

Decisions made for the implementer:
1. **One list, one home.** Export a single constant of mini-app limits from the prompts module. Each entry has
   plain words for the prompt plus the capability ids that would make it possible. It has at least: network and
   live data, notifications while the app is closed, and other people's devices. Interpolate it into
   `CLARIFY_SYSTEM` and `REWRITE_SYSTEM`. The "list and registry agree" test pins it against
   `checks/contract.ts#CAPABILITY_EXPORTS`, the build-time capability source: it fails if any capability id an
   entry names as missing appears there. Don't add a second capability list.
2. **`limit` only when the core is impossible.** A partly impossible request gets questions without the impossible
   extra, and the plan says plainly what's left out. If the model returns both `limit` and questions, keep the
   `limit`, drop the questions and log it at info (the contract rejects the combination). The route validates the
   arm (non-empty `reason`/`alternative`, each ≤ 200 chars after trimming), and a malformed `limit` degrades to
   today's questions path. Emit clarify bodies with `limit` unchanged; it's level 1.
3. **Answer modes (D18).** The clarify prompt sets `select` and `other` per question. Replace chain-1's interim
   `shapeClarify` defaults only where the model omits them: `'one'`/`false` stay the fallback. Plan writing:
   - Decide every `decide: true` question and name each decision in plain words in the plan rows.
   - Honour several `choices`.
   - Render `other` text as the user's own answer, quoted as data, never as an instruction.
   The server cannot enforce "at most one choice for `select: 'one'`" because a `Clarification` carries no mode
   and the server holds no state between calls. Don't try; the device enforces it (chain-4). Record this as
   class A.
4. **Content policy.** `server/src/policy/input.ts` classifies the prompt with every clarification's `choices`
   and `other` on `/v1/rewrite` and `/v1/generate` together, one input and one classification. A harmful `other`
   is refused exactly as the same text in the prompt would be: same status, code and hint. `decide` adds nothing
   to the input.
5. **Retry (D10).** Only generate and repair turns, only upstream failures (5xx, 429, network, stream error;
   never a content, parse or policy failure), and at most once per turn, with the same messages. Emit `restart`
   (through `eventForLevel`) only if the turn already yielded `token` events. Meter the failed attempt's usage.
   A second failure ends exactly as today. Replace the old declined-retry comment at `machine.ts:217` with the
   new behaviour; don't leave both.
6. **Verdict logging (D11).** `stages/run.ts` passes a content-free `{kind, check}`. The machine logs it once, at
   info with `requestId`, on `containment_failed`/`run_unverified`. The test asserts the fields and that no
   source, DOM or console text appears (plant a distinctive string in the run's inputs and assert it's absent).
7. **No-change (D13).** Reproduce #106 first with a generated-output-shaped fixture, then find the path. A
   no-change claim needs `delivered source === starting source` (byte equality). When the request carries no
   `app.source` (a pre-tracking install), the claim can't be verified: use the neutral line. Keep the summariser
   record-free; the equality check lives with its caller. Report the #106 root cause with file:line.
8. **Flowbench learns the new clarify shapes** (`server/src/flowbench/drive.ts` + `report.ts`):
   - A `limit` is its own outcome, `limit{reason, alternative}`, not a failure. It stops the case before rewrite
     and shows in the markdown table and the JSON.
   - Auto-answering stays "first option" for every question (comparable with the before run). It never uses
     `other` or `decide`.
   - Keep `summary.failures` meaning real failures only, and add a `limits` count.
9. Model ids only from env (the `prompts.suite` tripwire). No new terminal failure code is needed. If one is,
   stop with class B.

Gate: `./scripts/gate.sh` to FAST GATE PASSED. The prompts suite pins both prompts to the list and pins the
answer-mode instructions. Use a stub model for the plan-decides-delegated-question test. Red-check the retry
against one weaker variant (e.g. a retry that never emits `restart`, or one that retries twice) and the policy
against one (e.g. `other` omitted from the classified input), naming the failing tests. End the report with HARNESS
FEEDBACK (template in docs/harness-feedback/README.md).
