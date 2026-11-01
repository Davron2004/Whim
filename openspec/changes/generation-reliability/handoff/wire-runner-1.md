# wire runner findings (chain/generation-reliability-wire, BASE b6a3b2d6, tip 1abfe2b6)

Overall: FAIL (fast gate red on one server test; everything else passes).

1. Fast gate: capped-run.sh --mb 6144 --secs 1500 -- <wt>/scripts/gate.sh -> wire-gate.log
   exit 1. "FAST GATE FAILED: server" (5205 passed, 1 failed). All other steps PASS (build, typecheck, lint, launcher, scaffolding, SDK).
   Failing line (suite server/test/deploy-config.suite.ts:1689, "Deploy scripts: cloudrun/smoke.sh"):
   XX ... and the envelope the server's own drivers send (bench-envelope.ts), its build number within a minute of theirs
      — {"x-whim-protocol":"1",...} (smoke.sh request) vs {"x-whim-protocol":"2",...} (bench-envelope.ts)
   Cause: PROTOCOL_LEVEL went 1 -> 2, so server/src/bench-envelope.ts now sends protocol 2, but
   deploy/cloudrun/smoke.sh (SMOKE_PROTOCOL, line ~192; also deploy/lib.sh:512 hardcodes 'x-whim-protocol: 1')
   still sends 1. Real chain miss: the deploy smoke must follow the level (or the test must decouple), outside the
   chain's allowlist (deploy/**). Not a flake.
2. Integrity: fixloop.sh integrity (FIXLOOP_INTEGRATION_BRANCH=integration/beta-2-fixes) with allow-wire.txt -> exit 0, "INTEGRITY OK".
3. Removal ratchet: node scripts/removal-ratchet.mjs --base b6a3b2d6 --head chain/generation-reliability-wire -> exit 0, PASS,
   10 changed verification files compared, no "authorised:" lines, no drops reported (wire-future-frames.suite.ts included; builder says assertion count unchanged).
4. Red-checks (fixloop.sh redcheck; test command wrapped in scratchpad scripts because fixloop splits on any "--" in the test cmd):
   - device (--only service-refusal,flow-messages-ui,prompt-flow-ui,generation-client; PROD service-refusal.ts wire-compat.ts generation-client.ts pending-builds.ts LauncherRoot.tsx): exit 0 RED (wire-red-device.log).
   - server (--only wire-level; PROD server/src/wire-level.ts server/src/admission/refusals.ts): exit 0 RED, but COARSE: the suite
     failed to BUILD (server:test typecheck errors, e.g. wire-level.ts(83,3) TS1360, test imports of missing providerUnavailableRefusal), not on an assertion (wire-red-server.log).
   - Task 2.5 red-check skipped (standing pin, per brief).
5. git log b6a3b2d6..chain/generation-reliability-wire: no Co-Authored-By / attribution lines.

Worktree note: untracked .gitkeep appeared in the worktree (not from me; not committed).
