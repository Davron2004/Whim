# Sonar round 2 dispositions

2026-09-30: current PR head 46dbc32f6fa5349065b1558fb2af48e9def7354a; Sonar visibility verification exit 0, current PR ingestion exit 10 with gate ERROR and three findings. GitHub Sonar check failed; quality-gate passed; isolation-suite was pending. Captured checkverdict exit 9 is a real failure, not a green verdict inferred from an empty result.

Read-only researcher reconciled all three producers against current source and live keys. S1 and S2 have supported false-positive rationales in research.md; API transitions/readbacks remain pending. S3 is a real terminal-persistence defect and reopens R1 S75. R1 S22 maps to the now-closed age producer and remains complete.

S3: initial root stale check returned 7 because a purported verbatim standalone brace did not match HEAD; no dispatch occurred. Researcher corrected the evidence to two exact live statements. Root rerun actual exit 0, EVIDENCE PRESENT (2 lines). Corrected evidence.txt is authoritative.

S1, S2: root verified current key/rule/path/line against the PR, then transitioned only the two reviewed issues with sendNotifications=false. Supported API result: total 2, success 2, ignored 0, failures 0; both keys read back FALSE_POSITIVE. Receipt fp-receipt.json. These two findings are terminal; S3 remains source work. No issue comment or notification was sent.
