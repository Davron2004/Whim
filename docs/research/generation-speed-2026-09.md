# Where generation time went, and what to run instead

Measured on 2026-09-22 for #55 (on a phone, clarify took ~35 s and plan writing ~25 s before a build even started) and #51 (answer and plan submits failing with `policy_unavailable`, then passing on retry). The code change is `openspec/changes/faster-generation/`. Raw judge verdicts, inputs and the ledger of every step are in that folder (`bench/`, `progress.md`, `review-*.md`).

## The short version

One wrong assumption caused most of both issues. The server treated a request without a `reasoning` field as a request without reasoning. DeepSeek V4 reasons by default anyway, and the tokens it spends thinking count against the answer's token budget and the wall clock. So the content-policy classifier, clarify, plan writing and the post-build summary all ran a thinking pass nobody asked for:

- The classifier gets 48 tokens to answer. Hidden thinking used them up, the verdict came back empty or cut off, and the check failed closed. That is #51. Replaying the exact request, 4 of 15 verdicts were unparseable; with `reasoning: { enabled: false }`, 0 of 15.
- Clarify took ~30 s and plan writing 17–35 s. Nearly all of it was thinking. One clarify ran past the 60 s timeout and returned `502`.
- The summary after every build hit its own 20 s timeout. It never produced a summary, and the user waited the 20 s anyway, after the app was already built and checked.

The fix makes every model call state its reasoning mode, and the short calls turn it off. On the same models, clarify and plan writing now take about 2 s each, and the content check hasn't failed once in the runs since.

Code generation is the part where thinking earns its keep. I tested it both ways on 14 cases, and a blind judge scored the apps built with thinking 8.6/10 on average against 6.0 without it, on the same model. So thinking stays on for the first draft. What changed is everything around it.

## What to put in `deploy.env`

Keep both models. Add:

```
WHIM_PROVIDER_SORT=throughput
WHIM_REPAIR_REASONING=off
```

Clarify, plan writing, the summary and the classifier now default to reasoning off in code, so they need no setting. The engineer keeps its default (`on`). `WHIM_PROVIDER_SORT=throughput` asks OpenRouter for its fastest provider instead of its cheapest; default routing sent the same model to providers streaming anywhere from 26 to 390 tokens a second. `WHIM_REPAIR_REASONING=off` lets repairs skip thinking while first drafts keep it (see "Repairs" below for what that bought).

If a demo ever needs raw speed over polish, `WHIM_ENGINEER_REASONING=off` builds about six times faster (median 20 s instead of 87 s) and costs roughly 2.6 points of app quality on the judge's scale. That is a trade I would only make knowingly, for a prompt that has been rehearsed.

Every one of these is operator config; `docs/deploy.md` lists them all, with defaults. A deploy now accepts them in `~/.config/whim/deploy.env`; before this change the deploy whitelist would have rejected them as unknown variables.

## How I measured

Every number here comes from a local server started with a given roster, driven the way the phone drives it: `POST /v1/clarify`, answer each question with its first option, `POST /v1/rewrite` with those answers, then `POST /v1/generate` with the rewritten prompt and the answers (the request shapes from `LauncherRoot.tsx` and `buildGenerateRequest`). A fresh device id per case keeps admission limits out of the way. The committed version of this driver is `server/flowbench.mjs`.

For the engineer comparisons, one full run recorded the clarify answers and rewritten prompt per case, and every other configuration replayed exactly those inputs. Otherwise random differences in clarify and rewrite would have been mixed into the engineer comparison.

Timings come from two places: the stage events the client sees, and a new `model call` log line the server writes for every model call (role, model, upstream provider, time to first token, duration, and token counts including reasoning tokens). Costs come from OpenRouter's per-key usage counter and the server's usage ledger.

Quality came from two sources. The corpus-eval harness (`evals/cli.mjs run --source-dir`) checked every delivered app, and every app passed Tier A (static checks and containment) and rendered without errors. Its Tier B can't compare models, though. The visible set asserts a screen literally named `Home`, while generated apps name their first screen `Dashboard` or `Today`. It also asserts a storage write that the scripted tap-through rarely triggers. The real quality signal came from a blind judge instead. For each case, a Sonnet subagent read the request, the answers and every configuration's source under shuffled letters, then scored coverage, correctness and UX and ranked them. It never saw which model wrote what. Two independent rounds covered 6 and 8 cases.

The whole investigation spent $1.65 of the $2 OpenRouter budget (the key's usage went from $2.66 to $4.31) across about 100 full generations and a few hundred short probe calls. Generation itself is cheap. Every configuration I tested cost about a cent or less per delivered app.

## Before and after, same prompts, same models

The before column is today's production roster on today's code; the after column is the new code with the roster above. All on a local server, so the phone adds its network round trips on top.

| case | clarify | plan writing | build | whole flow |
|---|---|---|---|---|
| tip-splitter-p1 | 3.5 → 1.5 s | 17.3 → 2.4 s | 44.6 → 21.0 s | 65.4 → 24.9 s |
| habit-tracker-p1 | 29.5 → 2.1 s | 29.6 → 2.2 s | 122.6 → 50.9 s | 181.7 → 55.2 s |
| flashcards-p2 (one repair both times) | 32.0 → 3.4 s | 34.5 → 3.5 s | 225.9 → 93.6 s | 292.4 → 100.6 s |

The before runs also hit the #51 failure constantly: on a first pass without retries, 2 of 3 clarifies and 3 of 3 builds got `503 policy_unavailable`, and one clarify ran 61.7 s into a `502`. The after run used the committed `server/flowbench.mjs` with no retries, and nothing failed.

Inside the build, the wins come from four places. The plan stage went from 6–28 s to 4–6 s. The summary tail went from 20 s to about 1 s. The thinking generate call ran on a ~300 tokens-a-second provider instead of whatever was cheapest. And the one repair skipped thinking. The build still spends most of its time on the first draft's thinking pass, and that is on purpose.

## Clarify and plan writing

With reasoning off and fast routing, the model hardly matters for speed any more. I ran Whim's real clarify and rewrite prompts (copied from `server/src/generation/prompts/index.ts`) against 13 cheap models on six eval prompts:

| model | clarify median | plan median | questions asked per prompt | cost of all 12 calls |
|---|---|---|---|---|
| `deepseek/deepseek-v4-flash-0731` (current) | 1.8 s | 2.5 s | 0,0,3,3,2,3 | $0.0009 |
| `deepseek/deepseek-v4.1-flash` | 0.8 s | 3.0 s | never asks | $0.0028 |
| `deepseek/deepseek-v4-flash` | 2.1 s | 3.6 s | 0,0,2,3,3,3 | $0.0012 |
| `inclusionai/ling-3.0-flash` | 1.2 s | 1.7 s | 2,3,1,3,2,3 | $0.0003 |
| `qwen/qwen3.5-flash-02-23` | 1.7 s | 2.2 s | always 2 | $0.0009 |
| `qwen/qwen3.7-flash` | 2.1 s | 3.9 s | always 2 | $0.0005 |
| `qwen/qwen3.8-flash` | 2.7 s | 5.4 s | always 2 | $0.0017 |
| `qwen/qwen3.8-27b` | 1.7 s | 5.4 s | 1,2,0,3,1,1 | $0.0073 |
| `qwen/qwen3-next-80b-a3b-instruct` | 0.5 s | 3.2 s | only on 1 of 6 | $0.0022 |
| `qwen/qwen3-235b-a22b-2507` | 0.7 s | 3.6 s | only on 1 of 6 | $0.0016 |
| `bytedance-seed/seed-1.6-flash` | 1.9 s | 2.3 s | always 3 | $0.0011 |
| `tencent/hy3` | 1.6 s | 3.1 s | never asks | $0.0013 |
| `z-ai/glm-4.7-flash` | 4.1 s | 9.1 s | one malformed reply | $0.0014 |

Reading the actual questions settled it. The current model asks what changes the app: whether a streak allows missed days, one habit or several, how wrong an answer has to be before a flashcard comes back sooner. With reasoning off, its plans were as detailed as they were with thinking on, sometimes more so. Qwen 3.5 Flash narrows the app too early (it asked which habit, then built an exercise-only tracker). Seed asks three over-technical questions every time (tax rules on a tip calculator). The older `deepseek-v4-flash` treated a new app as an edit of an existing one. So I kept `deepseek-v4-flash-0731` for clarify, plan writing, the classifier and the summary.

Ling 3.0 Flash surprised me. Its questions were sensible and its plans detailed, at a third of the price. It is worth an A/B once there is a clarify-quality eval, but not a swap two days before a demo.

Some models refuse to turn reasoning off (`z-ai/glm-5.3-flash` and `stepfun/step-3.5-flash` return `400 Reasoning is mandatory`). Pointing `WHIM_REWRITE_MODEL` at one of those would make every classifier call fail closed; `docs/deploy.md` says so.

## Does code generation need to think?

Your instinct was that complex apps need thinking. The numbers agree, and the reason is specific. Thinking barely changes whether an app ships, since the repair loop catches anything that fails the checks. It changes how good the shipped app is. The repair loop only fixes what the static checks and the synthetic run can see; it can't notice a streak that never resets or an "edit" button that silently duplicates a record.

Speed and delivery, pooled over the two rounds (rounds 2 and 3, 14 cases, identical inputs per case):

| engineer | delivered | first pass | median build | p90 | max |
|---|---|---|---|---|---|
| `deepseek-v4.1-flash`, reasoning on (production today) | 14/14 | 7/14 | 87.4 s | 139.2 s | 303.1 s |
| `deepseek-v4.1-flash`, reasoning off | 14/14 | 6/14 | 20.3 s | 50.0 s | 99.3 s |
| `qwen/qwen3.8-27b`, reasoning off | 14/14 | 4/14 | 23.1 s | 48.6 s | 69.5 s |
| `deepseek-v4-flash-0731`, effort `low` (6 cases) | 6/6 | 2/6 | 172.2 s | 305.4 s | 340.9 s |
| `qwen/qwen3.5-flash-02-23`, off (6 cases) | 5/6 | 1/6 | 45.9 s | 81.1 s | 234.2 s |
| `deepseek-v4-flash-0731`, off (6 cases) | 3/6 | 2/6 | 19.1 s | 83.0 s | 94.2 s |
| `qwen/qwen3-coder-next` (6 cases) | 3/6 | 1/6 | 38.5 s | 98.1 s | 99.3 s |
| plan thinks, code doesn't (`v4.1-flash`, 8 cases) | 7/8 | 4/8 | 24.8 s | 35.3 s | 35.9 s |

Blind judge, overall score out of 10:

| engineer | mean | scored 8 or more | scored 4 or less |
|---|---|---|---|
| `deepseek-v4.1-flash`, reasoning on | 8.64 | 12/14 | 0/14 |
| `deepseek-v4-flash-0731`, effort `low` | 7.00 | 3/6 | 1/6 |
| `deepseek-v4.1-flash`, reasoning off | 6.00 | 4/14 | 2/14 |
| plan thinks, code doesn't | 6.00 | 2/7 | 2/7 |
| `qwen/qwen3.8-27b`, reasoning off | 4.86 | 2/14 | 5/14 |
| `qwen/qwen3.5-flash-02-23`, off | 2.60 | 0/5 | 5/5 |

The judge's notes show what goes missing without thinking: a habit tracker whose calendar keys didn't match its streak keys (so days 1–9 never counted), a packing list whose "edit template" appended a duplicate, a chore rotation whose second screen was unreachable. The thinking version of the same prompts had none of these.

Thinking in the plan stage instead of the code stage doesn't help. It scored the same as no thinking at all (6.0). The quality comes from the engineer thinking while it writes the code.

The thinking pass is where the build time goes. On the median generate call, 9,964 of 14,247 output tokens were reasoning. Two things make it cheaper without removing it.

Routing matters more than I expected. The same thinking call ran at ~166 tokens a second on Fireworks and ~350 on Together. Round 2's generate calls all landed on Fireworks (median 85.9 s); round 3's split between the two (median 55.3 s). `WHIM_PROVIDER_SORT=throughput` doesn't always pick the faster one; a provider preference list is on the follow-up list.

Repairs are the other lever. A repair gets the diagnostics and the current source and returns the full corrected file. With thinking on, the 9 repairs across those 14 cases took a median 36.6 s each (17.6 to 137.4 s). I added a separate repair role and ran the 7 cases that had needed repairs again, first drafts thinking and repairs not. All 7 delivered. Three of the four repairs took 6.6–14.5 s. The fourth took 111 s because routing sent it to a 43 tokens-a-second provider (Parasail), the same routing problem as above. Builds in that run had a median of 54.8 s against 87.4 s with thinking everywhere, though part of that gap is first-draft luck (fewer repairs were needed). I didn't judge the repaired apps separately. A repair only fixes what the checks flagged, and the features come from the first draft, so I don't expect a quality cost, but that is an expectation, not a measurement.

Effort levels don't help on this model. `reasoning: { effort: 'low' }` cut `v4-flash-0731`'s thinking about fourfold on a probe but did nothing measurable on `v4.1-flash`, and a reasoning token budget (`reasoning: { max_tokens }`) was ignored and pushed routing onto a slow provider.

### Qwen 3.8 27B

You asked about it specifically. It can be fast, but only on its fastest provider: DekaLLM streamed it at ~187 tokens a second, while its default route ran at ~28. In the first round, with reasoning on, DekaLLM dropped two streams mid-generation, and the pipeline doesn't retry an upstream `502` on an engineer turn, so both builds failed. With reasoning off it delivered 14 of 14 at about the same speed as DeepSeek without thinking, but its apps scored 4.86 on the judge's scale: apps with no way to add data, rotation logic that gave one chore to two people. It also costs about three times as much per app as `v4.1-flash`. I wouldn't run it today. If a fine-tuned version comes later, this benchmark is the way to check it.

## Found along the way, not fixed here

- **No retry on an upstream 5xx mid-generation** (#57). When DekaLLM dropped a `qwen3.8-27b` stream, the whole build failed with "Something went wrong". One retry of the engineer turn on a provider 5xx would have saved both runs.
- **"We couldn't verify this app ran safely" ends a build without repair** (#58). It happened twice in about 100 generations (`v4-flash-0731` off on tip-splitter-p1, `v4.1-flash` plan-thinking on packing-checklist-p1). The run stage lasted 0.1 s both times and the log keeps no detail, so I couldn't tell a model fault from a harness fault.
- **Tier B of the visible eval set can't compare models** (#59). It asserts a screen named `Home` and a storage write the tap-through rarely triggers. Accepting the entry screen and driving one write per assertion would make it useful.
- **The flow benchmark can't replay fixed inputs yet** (#60). My scratch driver had a `--reuse <run>` option that fed every configuration the same clarify answers and rewritten prompt. The committed `server/flowbench.mjs` should get the same thing (`--inputs <report.json>`), because without it, comparisons of engineers carry clarify and rewrite noise.
- **A provider preference list for the engineer** (#61). Together ran the thinking engineer about twice as fast as Fireworks. `provider.order` with fallbacks would pin that, at the cost of keeping the list current.
- **Clarify doesn't know what the SDK can do** (#62). With reasoning off it still sometimes offers reminders, which a mini-app can only approximate with local cues. A line about the SDK's limits in the clarify prompt would stop the plan from promising them.
- **The leftover `integration/store-launch` branch.** Its tree is identical to `main` (the launch run's pre-cleanup history, never torn down). It can go.

Streaming the plan rows and running the classifier concurrently, both suggested in #55, no longer seem worth it, now that plan writing takes about 2 s and the classifier about 0.7 s.

## Re-running this

Start a server with the roster you want to measure (the variables override `.env`):

```sh
WHIM_SERVER_PORT=8799 WHIM_PROVIDER_SORT=throughput WHIM_REPAIR_REASONING=off \
  WHIM_LOG_JSON=1 node --env-file-if-exists=.env server/dev.mjs > /tmp/whim-server.log
```

Drive the phone's flow and save what it built:

```sh
node server/flowbench.mjs --url http://127.0.0.1:8799 --eval-set evals/sets/visible \
  --cases tip-splitter-p1,habit-tracker-p1,flashcards-p2 --parallel 3 \
  --json /tmp/flowbench.json --save-sources /tmp/flowbench-src
```

Score the saved apps offline, and read per-call timings from the server log:

```sh
node evals/cli.mjs run --eval-set evals/sets/visible --source-dir /tmp/flowbench-src --out /tmp/flowbench-eval
grep '"model call"' /tmp/whim-server.log
```

The blind judge prompt is `openspec/changes/faster-generation/bench/judge-prompt.md`: give a subagent one folder per case holding `request.md` and each configuration's source under shuffled letters, and keep the key somewhere it can't read.
