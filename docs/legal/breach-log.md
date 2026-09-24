# Breach log

The record of every breach of security safeguards involving personal information that AnyCognition controls, as PIPEDA s.10.3 asks. Not legal advice. How to handle a breach is in `docs/legal/breach-runbook.md`.

## Rules

- **Every breach goes in**, including small ones and ones that didn't need a report or notice (s.10.3; canada.md, Appendix; practice-and-terms.md).
- **Keep each entry for at least 24 months** after the day you determined the breach happened (practice-and-terms.md: "keep a record of every breach for two years"). Don't delete entries after that unless you have a reason; this file holds no personal information, so keeping it longer costs nothing.
- **The OPC can ask to see this log** (s.10.3). It must show why you did or didn't report, so write the reasoning, not only the decision.
- **It also serves as Quebec's register of confidentiality incidents** (Quebec P-39.1 s.3.8; general knowledge, not in the research files) and as the record GDPR Art. 33(5) asks for (general knowledge).
- **This repository is public.** Write an entry only after the breach is contained and the cause fixed. Never put personal information, a secret, a phone ID or a description of an unfixed weakness here. Working notes and evidence stay in the private place the runbook names.

## Entry template

Copy this block for each breach, numbered in order (B-001, B-002, ...).

```markdown
### B-NNN: <one-line description>

- Learned of it: <date and time, how>
- When it happened: <date or period>
- What happened: <short account; cause if known>
- Systems: <VM, disk, logs, Cloud Logging, OpenRouter, a provider, phones, ...>
- Data categories: <manifest categories: request, app material, phone ID, usage records, error details, connection and log data, reports, app-integrity check>
- How many: <estimated number of phone IDs; say how you estimated>
- Contained: <date and time, what you did>
- Canada, real risk of significant harm (PIPEDA s.10.1): <yes or no>. Sensitivity: <...>. Likelihood of misuse: <...>.
- Quebec, risk of serious injury (s.3.5): <yes, no, or can't tell whether anyone in Quebec was affected>. Why: <...>
- EU and UK (Art. 33, 34): <no risk likely, risk, or high risk>. Why: <...>
- Reported to: <OPC date and reference | CAI date | ICO date | EU authority date | none>
- Other organizations told (s.10.2): <who, date | none>
- People told: <channels and dates | not required, because ...>
- Fix: <commit, config or process change>
- Promises checked: <which policy or consent-screen statements you re-checked, and the result>
- Evidence copies deleted: <date>
- Closed: <date>
- Keep until at least: <the date you determined it happened, plus 24 months>
```

## Entries

No breaches recorded yet.
