## MODIFIED Requirements

### Requirement: The first action that would send data asks for consent at that moment

The launcher SHALL open the first-run sheet over the current screen, in place of the requested screen, whenever the user takes a data-sending action without a current grant. The data-sending actions are: the home composer; changing an app from its tile menu, from inside the running app or from History; and trying a failed or stopped attempt again. After the user agrees, the action they started SHALL continue as if consent had already existed. Reattaching to a run that is already in flight sends nothing and SHALL NOT ask. Where another requirement of this capability says the consent screen opens for a data-sending action, the first-run sheet opens; the consent screen of "Settings shows consent and can review or turn it off" stays a full screen in review mode.

#### Scenario: Composer on a fresh install

- **WHEN** a user with no grant taps the home composer
- **THEN** the first-run sheet opens, the Describe page is not shown, and no request is sent

#### Scenario: Agreeing continues the started action

- **WHEN** the user agrees on a first-run sheet opened by "Change it" on an app
- **THEN** the Describe page opens in change mode for that app

#### Scenario: Agreeing continues a retry

- **WHEN** the user agrees on a first-run sheet opened by trying a failed attempt again
- **THEN** the retry starts from that attempt's stored description, exactly as it would with consent already granted

### Requirement: The disclosure names what is sent, what is never sent, and who receives it

The first-run sheet SHALL state the disclosure in two layers, in plain words from the copy table for the active legal language (see `legal-text-localization`), and both layers SHALL be on the sheet, reachable before any choice is taken.

The first layer SHALL always be visible above the choices: a title, a one-line lead saying that making or changing an app sends what the user asks for to Whim's server and that AI companies working for Whim write the code, and three summary rows. Between them the lead and the rows MUST name:

- every category of data that is sent: what the user asks for (with their answers and the plan they approve), the ID Whim makes for this phone, and error details;
- who receives it: the AI companies working for Whim, and in a few words every other recipient role the manifest marks as named on the screen (AnyCognition, the other companies that work for it, Apple or Google, and authorities when the law requires it);
- what it is used for;
- what stays on the phone, and what Whim never does.

The second layer SHALL be a "Full details" row on the same sheet that expands in place. It MAY start collapsed, and it SHALL be reachable before the terms checkbox is ticked and before the agree action is taken. Expanded, it SHALL state, in this order:

- what gets sent: what the user asks for (their description, their answers and the plan they approve); when changing an app, its name, code, description and data layout, never the data itself; an ID Whim makes for this phone and what it is used for; and error details, technical only, never what the user typed or saved;
- why: every purpose in the current disclosure manifest, in short words, including running Whim within its costs;
- who gets it: every recipient role the manifest marks as named on the screen. In version 2, those are AnyCognition; companies that work for it (some outside Canada), which can't train AI on the data or use it for their own products but may keep it briefly for security and legal reasons; Apple or Google checking that requests come from the real Whim app; and authorities when the law requires it;
- what the user saves in their apps: nobody at Whim can read it, it stays on the phone, and anything Whim ever syncs or backs up is encrypted on the phone with a key Whim never has;
- what Whim never does: show ads, sell data or share it for advertising, or track the user across other apps and websites;
- that Whim will ask first before collecting a new kind of information, using it for a new purpose, keeping it longer, or giving it to a new kind of company;
- that AI features and error details can each be turned off in Settings, and installed apps keep working either way.

Neither layer SHALL name any provider company or call the phone ID anonymous, and neither SHALL carry anything about the terms of use: the terms checkbox (see `terms-acceptance`) is a separate row under them. The sheet SHALL carry a privacy policy link that opens the policy URL for the active legal language in the system browser. All strings SHALL pass the product-verbs guard, and all styling SHALL come from the design tokens.

#### Scenario: The first layer is complete without expanding anything

- **WHEN** the first-run sheet renders at consent version 2 with "Full details" collapsed
- **THEN** the visible text names what the user asks for, the phone ID and error details as sent, the AI companies working for Whim and every other screen-named recipient role, and what the data is used for, and it shows the privacy policy link and no terms wording outside the checkbox row

#### Scenario: The full disclosure is one tap away before any act

- **WHEN** the user taps "Full details" before ticking the box or agreeing
- **THEN** each section above shows in order and names every screen-named role in the version-2 manifest

#### Scenario: No vendor on the sheet

- **WHEN** the copy tables for every language are scanned
- **THEN** no first-run or consent string contains "OpenRouter" or "anonymous"

#### Scenario: The privacy link follows the language

- **WHEN** the active legal language is French and the user taps the privacy policy link
- **THEN** the system browser opens the French policy URL derived from the release domain constant

### Requirement: Permission is explicit and declining keeps installed apps usable

The first-run sheet SHALL grant consent only through its explicit agree action (`Agree to send descriptions`), an act separate from the terms checkbox: ticking the checkbox SHALL grant nothing, and the agree action SHALL NOT tick it. Its decline action (`Not now`), close, drag, scrim, system back, and any other exit SHALL grant nothing. Nothing on the sheet SHALL be pre-selected or implied as agreement. The grant SHALL be recorded with the consent version, apart from the terms acceptance and its version (see `terms-acceptance`), and no clarify, rewrite, generate or probe request SHALL be sent until every act that was due is recorded.

Declining SHALL return the user to the screen that opened the sheet, or to Home when that screen was a running mini-app. After declining, every installed app SHALL still open, run, be copied, and show its history, and the next data-sending action SHALL ask again.

#### Scenario: Back declines

- **WHEN** the user presses system back on the first-run sheet
- **THEN** no grant and no acceptance are stored and the user returns to the screen that opened it

#### Scenario: Apps keep working after declining

- **WHEN** the user declines and then opens an example app, makes a copy of it, and opens its history
- **THEN** all three work, and no request has been sent

#### Scenario: Two acts, two records

- **WHEN** a user with neither record ticks the terms box and takes `Agree to send descriptions`
- **THEN** the terms acceptance is stored under its key with the terms version and the grant under its key with the consent version

#### Scenario: Nothing is sent before both acts

- **WHEN** the first-run sheet is open on a fresh install, with the box ticked or not
- **THEN** no request has been sent, and the first request leaves only after the agree action has recorded both acts
