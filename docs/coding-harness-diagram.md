1. The per-finding pipeline

```mermaid
flowchart TD
    IN[/"IN: one finding + severity<br/>(fix-fest / critic / spec)"/]:::io --> PLAN
 
    PLAN["Planner — read-only<br/>defines DONE: fix, test,<br/>file allowlist, red-without-fix"]:::auto --> WT
 
    WT["Orchestrator: create worktree<br/>branch fix-id from PINNED BASE<br/>BASE = rev-parse integration/run-id (staging tip, recorded)"]:::orch --> FIX
 
    subgraph ISO["isolated worktree — scoped git (cwd under .claude/worktrees), toolchain resolves, no push / merge / ref-writes"]
      direction TD
      FIX["Fixer subagent<br/>writes fix + test, commits in worktree"]:::auto --> G1
      G1{"Fast gate<br/>typecheck + lint + unit"}:::gate -->|"fail, attempts left"| FIX
      G1 -->|"fail, cap hit"| F1(["failed-gate: report, no merge"]):::fail
      G1 -->|"pass"| RED{"Red-check — separate context<br/>revert fix, keep test, run<br/>expect RED"}:::gate
      RED -->|"green = vacuous test"| F2(["reject: test proves nothing"]):::fail
    end
 
    RED -->|"RED"| INTEG{"Orchestrator integrity check<br/>diff vs PINNED BASE:<br/>protected files untouched?<br/>changes within allowlist?"}:::orch
 
    INTEG -->|"protected file touched"| ESC{{"ESCALATE to human<br/>orchestrator never self-approves"}}:::human
    INTEG -->|"file outside allowlist"| F3(["reject: scope violation"]):::fail
    INTEG -->|"clean"| VER{"Verifier subagent — read-only, adversarial<br/>sees diff + gate + red-proof,<br/>not fixer reasoning · default-reject"}:::auto
 
    VER -->|"reject"| F4(["reject: re-plan or drop"]):::fail
    VER -->|"accept"| GF{"Full gate<br/>build + invariants + bridge<br/>+ openspec + tripwires"}:::gate
 
    GF -->|"fail"| F5(["reject"]):::fail
    GF -->|"pass"| SEV{"severity?"}:::orch
 
    SEV -->|"low / med"| MERGE
    SEV -->|"high"| HUM
    ESC --> HUM{{"Human ratifies"}}:::human
    HUM -->|"approve"| MERGE
    HUM -->|"deny"| F6(["reject"]):::fail
 
    MERGE["Orchestrator merge fix-id into integration/run-id<br/>SERIALIZED — single writer, main untouched"]:::orch --> CLEAN["worktree remove + delete branch"]:::orch --> OUT[/"OUT: landed commit on the run's<br/>staging branch (integration/run-id)"/]:::io
 
    classDef io fill:#e8f0fe,stroke:#4285f4,color:#111
    classDef auto fill:#ffffff,stroke:#9aa0a6,color:#111
    classDef gate fill:#fef7e0,stroke:#f9ab00,color:#111
    classDef orch fill:#f3e8fd,stroke:#a142f4,color:#111
    classDef human fill:#fce8e6,stroke:#ea4335,color:#111
    classDef fail fill:#fde7e9,stroke:#c5221f,color:#111
```

2. The parallel / fan-out view

```mermaid
flowchart LR
    BATCH[/"Batch of findings"/]:::io --> ORCH{{"Orchestrator — main thread<br/>plans + fans out"}}:::orch
 
    ORCH --> W1["worktree fix-1<br/>fixer · gates · red-check"]:::auto
    ORCH --> W2["worktree fix-2<br/>fixer · gates · red-check"]:::auto
    ORCH --> W3["worktree fix-N<br/>fixer · gates · red-check"]:::auto
 
    W1 --> Q{{"Orchestrator merge queue<br/>SERIALIZED — single writer<br/>integrity · verifier · full gate · approval"}}:::orch
    W2 --> Q
    W3 --> Q
 
    Q --> DV[/"integration/run-id (staging, landed)"/]:::io
    Q -.->|"escalate / reject"| HOLD(["human review / dropped"]):::human
 
    DV --> PUSH{{"Human (attended only):<br/>push integration/run-id<br/>+ draft PR → main"}}:::human
    PUSH --> SONAR["SonarCloud rounds on the draft PR<br/>nested /fix-loop on integration/run-id<br/>re-push until green"]:::auto
    SONAR --> CLEANUP{{"Human: /git-cleanup<br/>target=integration/run-id<br/>applies reset + force-with-lease push"}}:::human
    CLEANUP --> FMERGE{{"Human: ancestor check<br/>(main is ancestor of integration/run-id) passes,<br/>merge --no-ff into main, push"}}:::human
    FMERGE --> MAINOUT[/"OUT: main — one ratified merge,<br/>no post-merge regate"/]:::io

    classDef io fill:#e8f0fe,stroke:#4285f4,color:#111
    classDef auto fill:#ffffff,stroke:#9aa0a6,color:#111
    classDef orch fill:#f3e8fd,stroke:#a142f4,color:#111
    classDef human fill:#fce8e6,stroke:#ea4335,color:#111
```

Legend — who approves what (the colors)

┌───────────┬──────────────────────────────────────────────────┬──────────────────────────────────────────────────────────┐
│   Color   │                      Actor                       │                    Approval authority                    │
├───────────┼──────────────────────────────────────────────────┼──────────────────────────────────────────────────────────┤
│ 🔵 Blue   │ Inputs / outputs                                 │ —                                                        │
├───────────┼──────────────────────────────────────────────────┼──────────────────────────────────────────────────────────┤
│ ⚪ White  │ Subagent work (fixer, verifier)                  │ Bounded autonomy, no human                               │
├───────────┼──────────────────────────────────────────────────┼──────────────────────────────────────────────────────────┤
│ 🟡 Yellow │ Automated gate (fast gate, red-check, full gate) │ Exit code decides — no human                             │
├───────────┼──────────────────────────────────────────────────┼──────────────────────────────────────────────────────────┤
│ 🟣 Purple │ Orchestrator (main thread)                       │ Auto-approves only low/med merges; merges are serialized │
├───────────┼──────────────────────────────────────────────────┼──────────────────────────────────────────────────────────┤
│ 🔴 Red    │ You (human)                                      │ Ratifies highs + every protected-file touch; can deny    │
└───────────┴──────────────────────────────────────────────────┴──────────────────────────────────────────────────────────┘

The two structural invariants the picture encodes: (a) the pinned BASE is the only trust anchor — every integrity question is "diff vs BASE," never "diff vs HEAD"; (b) fan-out is parallel, but the merge queue is a single serialized writer to the run's staging branch (`integration/<run-id>`), so two fixes never race the same branch — `main` stays untouched until the attended closure phase lands the single ratified merge.

Failure modes (every red exit)

1. Fast gate fails + attempt cap hit → failed-gate, reported, nothing merges.
2. Red-check comes back green → vacuous-test reject (the crown-jewel check).
3. Integrity: a protected file changed → escalate to you (not auto-rejected — you decide).
4. Integrity: a file outside the declared allowlist changed → scope-violation reject.
5. Verifier rejects → re-plan or drop.
6. Full gate fails → reject.
7. You deny an escalation/high → reject.

```mermaid
flowchart TD
    subgraph WALLS["the three walls"]
      WG["fast-gate cap hit"]:::fail
      WV["verifier reject"]:::fail
      WS["scope violation<br/>(non-protected file outside allowlist)"]:::fail
    end

    WG --> DG{"orchestrator:<br/>extended-attempt budget left?"}:::orch
    DG -->|"yes"| RETRY["one harder attempt<br/>(more effort + gate tail handed back)"]:::auto --> RE
    DG -->|"no"| PARK

    WV --> DV{"orchestrator:<br/>revision cap left?"}:::orch
    DV -->|"yes"| REVISE["bounce critique to fixer<br/>(iterate on same branch)"]:::auto --> RE
    DV -->|"no"| PARK

    WS --> DS{"orchestrator: does re-plan stay<br/>same-subsystem & non-protected?"}:::orch
    DS -->|"yes"| REPLAN["widen allowlist, re-verify<br/>(reuses the SAME code)"]:::auto --> RE
    DS -->|"no"| ESC["escalate to human"]:::human

    RE(("resume<br/>same branch")):::auto
    PARK["PARK: rename fix-id to wip-id<br/>keep branch + reason note<br/>(dir removable, branch persists)"]:::io
    PARK --> RESUME[/"resumable later:<br/>git worktree add path wip-id<br/>— next run or human"/]:::io
    ESC --> HUMAN["human: approve wider scope<br/>· re-plan · drop"]:::human

    classDef io fill:#e8f0fe,stroke:#4285f4,color:#111
    classDef auto fill:#ffffff,stroke:#9aa0a6,color:#111
    classDef orch fill:#f3e8fd,stroke:#a142f4,color:#111
    classDef human fill:#fce8e6,stroke:#ea4335,color:#111
    classDef fail fill:#fde7e9,stroke:#c5221f,color:#111
```