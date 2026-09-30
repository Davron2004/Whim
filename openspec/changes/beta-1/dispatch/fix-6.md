# fix-6: clarify answers "can't build" reliably (limit rate), measured by rate

Root cause (investigation, progress.md): the clarify call is stochastic and the `limit` arm is an afterthought
at the end of `CLARIFY_SYSTEM` (`server/src/generation/prompts/index.ts:285-309`), after "an empty list is a good
answer". weather-p1 gets `limit` ~27% of the time. The app and flowbench send identical requests.

1. **Prompt: the limit decision comes first.** The clarify reply schema always carries
   `"limit": null | {reason, alternative}`, listed BEFORE `questions`. The prompt tells the model to first
   decide whether the request's core needs something in `MINI_APP_LIMITS` (only then `limit`, with empty
   `questions`), and to write questions only when `limit` is null. It keeps the partly-impossible rule (no option
   for an impossible add-on; the plan says it's left out) and the rule that a question never offers live data
   or other forbidden capabilities as an option: the investigation saw options like "Current weather". Keep the
   limits list interpolated from the one constant, and update the prompts-suite pins (schema order, the decision
   instruction, no forbidden-capability options).
   The server-side parse (`shapeClarify`) accepts `limit: null` as "no limit" (the contract's `ClarifyResponse`
   has `limit` optional; the route keeps sending the wire shape without `limit` when it's null). Check that the
   device never sees `limit: null` on the wire, or that it tolerates it; the tolerant reader should, but test it.
2. **Temperature 0 for the clarify call.** `ModelRequest.temperature` is already passed through
   (`openrouter.ts:182`). Set it for clarify only, via the same seam other per-route settings use, with a test
   that the clarify request body carries `temperature: 0` and the other routes are unchanged.
3. **Log an unusable limit.** When the model returned a `limit` that `shapeClarify` drops (empty field or >200
   chars), log it at info with `requestId` and the field lengths (never the text), and test that.
4. **flowbench measures rates.**
   - `--repeat N` runs each case N times and reports a per-case outcome tally (`limit`/`questions`/`empty`/
     `failure`) in the markdown and the JSON.
   - `--stop-after clarify` ends each run after the clarify call, so a rate check never pays for builds.
   - Tests in `server/test/flowbench.suite.ts`.
Scope: `server/src/generation/prompts/index.ts`, `server/src/routes/clarify.ts`, the model-request seam for
clarify, `server/src/flowbench/*`, and their tests. Not the device. Gate-full-only suite: `npm run server:e2e`.
The orchestrator measures after deploy: `--repeat 10 --stop-after clarify` over the limits set, and the visible set
for false limits.
