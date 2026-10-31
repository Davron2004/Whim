# chain-2 runner verdict (branch chain/beta-2-spec-fixes-2, tip b1b13671)

Verdict: PASS (device E2E not in scope; runs on staging after merge)

1. gate.sh: FAST GATE PASSED, no `^FAIL` lines; no #232 flake and no fixloop-preflight stderr line in the gate run. Log: scratchpad/runner-2-gate.log.
2. integrity (FIXLOOP_INTEGRATION_BRANCH=integration/beta-2): INTEGRITY OK, exit 0. Base f42268b0. 25 changed files, all under docs/design, the change folder, src/host/launcher (+test), src/host/ui/AppTile.tsx; none flagged.
3. removal ratchet (base f42268b0): PASS, exit 0, no `authorised:` lines.
4. transport red-check (b): mutation = keepalive-only first chunk (first byte ':') does not disarm the connect window, in generation-client.ts read() and xhr-transport.ts onprogress. `launcher:test` exit 1. Red:
   - generateApp (fetch path): a keepalive as the first chunk disarms the connect window, 20 s / 35 s steps
   - openXhrGenerateStream: same case ("opening keepalive disarms" got 1 want 0; "20 s first step fires no timeout" got 1 want 0)
   Only those two named cases failed, plus the known flake #232 (whim sheet "past a hundred versions", timed out waiting for the version line) which also surfaced under this load. The first XHR attempt of the mutation threw TypeError on every XHR test (wrong type, chunk.value is bytes); discarded, the second run is the evidence.
   Restored with git checkout; `git status --short` shows only the untracked .gitkeep.
5. co-authored trailers in integration/beta-2..chain: 0.
