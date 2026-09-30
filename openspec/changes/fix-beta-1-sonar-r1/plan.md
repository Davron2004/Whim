# Sonar round 1 plan

Nested in beta-1 closure on `integration/beta-1`, PR #137. The first completed analysis reports 96 findings. Read-only planning reconciled each against HEAD before dispatch.

Group related locations into disjoint file scopes where one structural correction addresses the same rule. Preserve promise/error semantics, FIFO order, cancellation, sequential model/fixture work and device compatibility. Do not weaken checks or add patch-shaped tests.

Per-finding dispositions and evidence are recorded before workers start. The checklist tracks terminal dispositions; a worker report alone does not complete a finding.

Ready cohort DONE specs, evidence and allowlists are in done/, evidence/ and allowlists/. Related locations share a single file owner and gate receipt; every location retains a separate terminal disposition.

Current confirmed state: 26 source findings merged and regated; 60 false-positive dispositions confirmed through Sonar. The remaining 10 checkboxes stay open. Initial void sweep plans have been superseded by producer reconciliation and targeted behavior plans; see dispositions.md and the corrected DONE specs.

## Finding checklist

- [ ] S1
- [x] S2
- [ ] S3
- [ ] S4
- [x] S5
- [x] S6
- [x] S7
- [x] S8
- [x] S9
- [x] S10
- [x] S11
- [x] S12
- [x] S13
- [x] S14
- [x] S15
- [x] S16
- [x] S17
- [x] S18
- [x] S19
- [x] S20
- [x] S21
- [x] S22
- [x] S23
- [x] S24
- [x] S25
- [x] S26
- [x] S27
- [x] S28
- [x] S29
- [x] S30
- [x] S31
- [x] S32
- [x] S33
- [x] S34
- [ ] S35
- [x] S36
- [x] S37
- [x] S38
- [x] S39
- [x] S40
- [x] S41
- [x] S42
- [x] S43
- [x] S44
- [x] S45
- [ ] S46
- [x] S47
- [x] S48
- [x] S49
- [x] S50
- [x] S51
- [x] S52
- [x] S53
- [x] S54
- [x] S55
- [x] S56
- [x] S57
- [x] S58
- [x] S59
- [x] S60
- [x] S61
- [x] S62
- [x] S63
- [x] S64
- [x] S65
- [x] S66
- [x] S67
- [x] S68
- [x] S69
- [x] S70
- [x] S71
- [x] S72
- [x] S73
- [x] S74
- [x] S75
- [x] S76
- [x] S77
- [ ] S78
- [x] S79
- [x] S80
- [ ] S81
- [ ] S82
- [x] S83
- [x] S84
- [ ] S85
- [x] S86
- [x] S87
- [ ] S88
- [x] S89
- [x] S90
- [x] S91
- [x] S92
- [x] S93
- [x] S94
- [x] S95
- [x] S96
