# fix-9 (normalized CPU p95 in the load test), implementer, Sonnet

- **What:** The dispatch block's phrase "have the sampler read nproc once over the same ssh" settled a design question (embed a `cores,<N>` line in the same ssh stream vs. a second ssh round-trip vs. a new CLI flag) that would otherwise have needed a class-B stop. **Mechanism:** chain block; reading `deploy/lib.sh`'s `whim_vm_ssh` (one command per invocation) made the constraint concrete. **Verdict:** NEUTRAL (worked well). **Cost:** ~15 min reading `deploy/lib.sh` and the stub test for the quoting pattern (a wrong escape in `run.sh` is only detectable by the shell-level suite). **Evidence:** `deploy/lib.sh:121`, `server/test/deploy-config.suite.ts` `loadtestDriveTests`.

Proposal: blocks touching `deploy/loadtest/run.sh`'s ssh sampler should cite `deploy/lib.sh#whim_vm_ssh`'s one-shot-command shape directly.
