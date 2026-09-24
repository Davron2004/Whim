# developer-observability Sonar round 1, TypeScript (fix-worker) — harness feedback

- **What:** Every long command (gate, knip, invariants) exceeded the Bash tool's 120 s foreground timeout; a sleep/poll attempt was blocked; only `run_in_background` + notification worked. **Mechanism:** tooling. **Verdict:** ENV. **Cost:** one failed attempt.
- **What:** S7758 (`charCodeAt`→`codePointAt`) in a UTF-8 byte counter isn't a mechanical rewrite; it needed the equivalent branch derived from first principles (and fixed a lone-surrogate edge). **Mechanism:** Sonar fix routed as mechanical. **Verdict:** DRAWBACK (risk). **Cost:** extra reasoning.

**What helped:** exact `file:line — rule` findings; per-agent named logs in the shared scratchpad.

**What the harness should change:**
1. Document that gate/invariants/knip exceed 120 s and `run_in_background` is the sanctioned wait.
2. Flag encoding/byte-math Sonar findings for review rather than the mechanical lane.
