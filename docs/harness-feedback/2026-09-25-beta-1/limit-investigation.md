# Limit investigation (why the app never got `limit`), general-purpose, Opus

- **What:** a model-driven reply shape (`limit`) was accepted on one flowbench sample per prompt. **Mechanism:** flowbench runs each case once and only reports the outcome; it has no repeat count, no per-case rate, and no way to stop after clarify, so a limit-rate check also pays for a full build whenever the limit doesn't appear. **Verdict:** CAUGHT-REAL-MISTAKE (in the orchestrator's 10.3 acceptance: "4/4" didn't reproduce). **Cost:** this investigation, one wasted generation. **Evidence:** `openspec/changes/beta-1/flowbench/after-limits.json` (1/1 for weather-p1 at 02:28 UTC) against 2/8 at 03:27 UTC on the same server commit. The simulator's system network log, with response sizes, settled the device side without server logs.

Proposal: flowbench `--repeat N` with a per-case rate, and `--stop-after clarify`.
