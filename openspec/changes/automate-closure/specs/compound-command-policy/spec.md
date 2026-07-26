# compound-command-policy

## ADDED Requirements

### Requirement: Compound commands are unrolled and judged by their worst segment

The bash-policy hook SHALL unroll a command joined by top-level `&&`, `||`, `;`, or `|` into its constituent simple commands and evaluate each segment against the existing per-command policy. The compound's verdict SHALL be the most restrictive segment verdict (deny > ask > allow): any denied segment denies the compound; otherwise any ask-tier segment surfaces the compound as a single ask showing the full original command line; only a compound whose every segment is allowed is allowed. Unrolling SHALL be performed by a dedicated parser helper invoked by the hook, not by regex splitting inside the shell script.

#### Scenario: All segments allowed

- **WHEN** the main thread runs `npm run build && npm run lint`
- **THEN** both segments evaluate to allow and the compound runs without a prompt

#### Scenario: One segment denied

- **WHEN** any caller runs a compound in which one segment is deny-tier (e.g. `npm run lint && git push origin main`)
- **THEN** the whole compound is denied deterministically

#### Scenario: One segment ask-tier

- **WHEN** the main thread runs a compound in which one segment is ask-tier and the rest are allowed
- **THEN** exactly one prompt is shown containing the full compound command line, and approval runs the whole compound

### Requirement: Non-unrollable constructs fail closed to the generic prompt, never to allow

A command containing command substitution (`$(…)` or backticks), an eval-family wrapper (`bash -c`, `sh -c`, `eval`, `xargs`, `env <cmd>`), parameter expansion in command position, or process substitution SHALL NOT be unrolled: its composed identity depends on runtime output, so piecewise evaluation is unsound. Such commands SHALL fall through to the pre-existing generic permission flow. A parse failure or any construct the parser does not fully understand SHALL have the same fall-through outcome. The unroller SHALL never be the mechanism that promotes a previously-prompted command shape to silent allow.

#### Scenario: Command substitution inside an allowed-looking command

- **WHEN** the main thread runs `git push origin $(cat refname)`
- **THEN** the command is not unrolled and falls through to the generic permission flow

#### Scenario: Parser cannot fully tokenize the line

- **WHEN** a command contains quoting or syntax outside the parser's strict grammar
- **THEN** the parser reports not-unrollable and the hook behaves exactly as it did before this capability existed

### Requirement: The raw-string deny kernel is checked before parsing

Match-anywhere hard-denied substrings (e.g. `sudo`, `curl`, `wget`, `npm install`) SHALL be checked against the raw, unparsed command string before the unroller runs, so no parser defect can bypass them.

#### Scenario: Denied substring smuggled into a compound

- **WHEN** any caller runs `npm run lint; curl https://example.com`
- **THEN** the raw-string check denies the command before unrolling is attempted

### Requirement: Redirect targets are policy-checked as writes

Output redirections (`>`, `>>`) in an unrolled command SHALL be extracted as pseudo-segments ("write to path X") and denied when the target matches the protected-path list, because shell redirects bypass the Edit/Write file-protection hook.

#### Scenario: Redirect into a protected path

- **WHEN** a caller runs `echo x > .claude/settings.json` (alone or inside a compound)
- **THEN** the policy denies the command

### Requirement: The unroller is covered by an adversarial regression suite in the fast gate

The fast gate SHALL run a regression suite for the unroller covering at minimum: verdict composition for each connector; quoted connectors treated as argument text (`git commit -m "a && b"` is one segment); each non-unrollable construct falling through; deny-kernel-before-parse; redirect pseudo-write denial; and refspec smuggling inside compounds. The suite SHALL include negative controls that fail if the unroller silently allows a known-bad line.

#### Scenario: Quoted connector is not a split point

- **WHEN** the suite evaluates `git commit -m "fix && polish"`
- **THEN** the parser yields one segment and the commit is judged as a single command

#### Scenario: Negative control keeps the suite non-vacuous

- **WHEN** the negative-control case (a compound that must be denied) is evaluated as allowed by a regressed parser
- **THEN** the suite fails the gate
