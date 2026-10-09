## ADDED Requirements

### Requirement: One pass through the legal flow shows each legal screen at most once
The launcher SHALL route every entry into the legal flow, including Settings' "Turn on AI features", through the single next-legal-step decision, and one pass SHALL show each legal screen (age, terms, consent) at most once.

#### Scenario: Turn on AI features with outdated terms
- **WHEN** a user whose terms acceptance is not current taps "Turn on AI features" in Settings
- **THEN** the terms step is shown, then the consent screen once, and AI features are on after that one consent

#### Scenario: Turn on AI features with current terms
- **WHEN** a user whose terms acceptance is current taps "Turn on AI features"
- **THEN** exactly one consent screen is shown and no terms step
