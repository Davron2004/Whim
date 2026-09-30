# Resolver-route false-positive rationale

Scope: PR 137, initial Sonar analysis at a1586b87. All rows below are current OPEN
SonarCloud issues, rule typescript:S9383, severity MAJOR.

| Finding | Issue key | Path:line |
| --- | --- | --- |
| S8 | AaDv2Gn6DHOwsfbTeJiL | server/src/routes/generate.ts:448 |
| S23 | AaDv2Gn6DHOwsfbTeJiQ | server/src/routes/generate.ts:792 |
| S24 | AaDv2Gn6DHOwsfbTeJiS | server/src/routes/generate.ts:798 |
| S26 | AaDv2Gn6DHOwsfbTeJiK | server/src/routes/generate.ts:411 |
| S51 | AaDv2Gm6DHOwsfbTeJiD | server/src/routes/clarify.ts:220 |
| S52 | AaDv2Gm6DHOwsfbTeJiE | server/src/routes/clarify.ts:223 |
| S53 | AaDv2Gm6DHOwsfbTeJiF | server/src/routes/clarify.ts:226 |
| S54 | AaDv2Gm6DHOwsfbTeJiG | server/src/routes/clarify.ts:362 |
| S55 | AaDv2Gm6DHOwsfbTeJiH | server/src/routes/clarify.ts:394 |
| S56 | AaDv2Gn6DHOwsfbTeJiI | server/src/routes/generate.ts:364 |
| S57 | AaDv2Gn6DHOwsfbTeJiJ | server/src/routes/generate.ts:375 |
| S58 | AaDv2Gn6DHOwsfbTeJiR | server/src/routes/generate.ts:795 |
| S59 | AaDv2Gl8DHOwsfbTeJiC | server/src/routes/rewrite.ts:339 |

Each call passes resolveRequestUsage to ResolveTracker.track. The producer has an explicit
never-reject contract: its full body is enclosed by a catch that converts transport and
usage-store failures into best-effort cost-resolution completion
(server/src/usage/resolve.ts:214-258). ResolveTracker.track adds both settlement arms to
the same promise before it returns it (server/src/usage/resolve.ts:375-383); its rejection
arm removes the promise from the drain set, and drain waits through settlement. Therefore
the route call sites have already observed their producer's rejection and remain included
in drain accounting.

S9383 sees only the returned promise expression and misses the producer-plus-tracker
contract. Appending void, an empty catch, or catch(() => undefined) at the thirteen sites
adds a redundant observer without changing request timing, accounting, or drain behavior.
The current worker changes must be reverted. Mark all thirteen issues FALSE_POSITIVE with
notifications disabled, then read back the issue keys. This rationale does not cover
S29 at generate.ts:658: that LineTicket constructor is a separate real finding.
