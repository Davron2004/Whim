## MODIFIED Requirements

### Requirement: The sheet previews exactly the body that Send transmits
The sheet SHALL hide the "what gets sent" heading and preview until a reason is selected. It SHALL then render the preview from the same `ReportRequest` value that the send action posts, so the two cannot differ. The preview SHALL list the reason, the note when present, the app name, the prompt that made the version being reported (full text, expandable), and the app's code (its size, with the full text expandable). It SHALL state that this phone's Whim ID goes with the report and that the report goes to AnyCognition, the company that makes Whim, and it SHALL carry a privacy policy link, because a report skips the consent screen and the sheet is its notice. No report string SHALL call the ID anonymous or promise that every report is read.

The active version's original source SHALL always be included when stored. The sheet SHALL explain in plain language that the code is included to investigate the report. The prompt for the active version SHALL have an include switch, on by default. Switching it off SHALL remove the prompt from both the preview and the body. When the app has no stored source, the sheet SHALL say so, the code row SHALL be absent, and `source` SHALL be omitted.

#### Scenario: Preview and body agree
- **WHEN** the user chooses a reason, writes a note, and sends
- **THEN** the posted body's `reason`, `note`, `appName`, `prompt`, and `source` are exactly the values the preview showed

#### Scenario: Code is part of a report
- **WHEN** the active version has stored original source and the user sends a report
- **THEN** the preview lists the code, the posted body includes that source, and no code opt-out is offered

#### Scenario: No reason chosen yet
- **WHEN** the report sheet opens without a chosen reason
- **THEN** neither the "what gets sent" heading nor its preview card is shown

#### Scenario: A legacy app without stored source
- **WHEN** the reported version has no stored source
- **THEN** the preview shows no code row and the body has no `source` key

#### Scenario: The sheet is the report's notice
- **WHEN** a reason is selected
- **THEN** the preview says this phone's Whim ID goes with the report to AnyCognition, shows a privacy policy link, and the thank-you state after sending says "Thanks. We'll look into it." with no promise that every report is read
