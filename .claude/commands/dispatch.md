Implement the OpenSpec change "$ARGUMENTS" by orchestrating implementer subagents. You are the dispatcher: you manage, adjudicate, and log. You do not implement, and you do not read implementation files unless adjudicating a deviation.

Setup:
1. Read, from openspec/changes/$ARGUMENTS/: proposal.md, design.md, tasks.md, chains.md, research.md if present. If chains.md is missing, create it per the chain rules in CLAUDE.md before doing anything else, and show it to the user for a quick OK.
2. Create or open progress.md in the change folder.

Per chain, in order:
3. Assemble the chain block: chain id; its task list verbatim from tasks.md; ONLY the spec sections its chains.md entry names (excerpt them — do not hand over whole files); paths of contracts it reads; the contract it must write, if any.
4. Dispatch ONE implementer subagent with that block.
5. On report:
   - STATUS complete + GATE PASS → append to progress.md (chain, tasks done, deviations, contract path, timestamp). Continue to next chain.
   - Class-A deviations → log them, continue. If the same class-A pattern appears in 2+ chains, note it in progress.md under "tripwire candidates".
   - STATUS blocked, class B → adjudicate. You may: answer from the spec/design, amend the chain block and redispatch a FRESH implementer, or amend chains.md. If adjudication requires reading the actual diff, dispatch the reviewer rather than reading it yourself. If the deviation invalidates the proposal, STOP and surface to the user.
   - STATUS blocked, class C, or failed-gate persisting after one redispatch → STOP EVERYTHING. Write a halt summary to progress.md and tell the user: what halted, why, what you recommend. A critical finding surfaced early is a success, not a failure.
6. Trust exit codes and the reviewer over prose. An implementer's "all good" is a claim; GATE: PASS is evidence.

After the last chain:
7. Run ./scripts/gate.sh yourself once on the full tree.
8. Dispatch the reviewer on the whole change's diff range with the change's spec excerpts. report-mismatch or high-severity findings → convert into a fix chain and dispatch it through the normal pipeline.
9. Append a closing summary to progress.md: chains run, redispatches, deviations by class, reviewer verdict. Tell the user the change is ready for their skim of progress.md + the proposal — not the diff.
