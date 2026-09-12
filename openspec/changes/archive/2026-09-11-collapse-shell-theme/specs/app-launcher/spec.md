## ADDED Requirements

### Requirement: The shell palette is a module constant, never a parameter

The launcher SHALL expose its shell palette as one module constant derived from the fixed v2 theme; no launcher component, hook, context, or helper SHALL accept a theme or palette as a prop, argument, or context value, except the fixed theme forwarded opaquely into mini-app delivery; and no launcher source SHALL name a theme picker or theme preference.

#### Scenario: A source scan finds no `ShellPalette` mention outside theme.ts, no theme context, and no theme picker mention

- **WHEN** launcher source outside `theme.ts` is scanned for the identifier `ShellPalette`, a theme context/hook, or the phrase "theme picker"
- **THEN** none exists and the suite fails naming the file if one appears

#### Scenario: A new component reads the constant and matches every other screen

- **WHEN** a new component needs shell colours
- **THEN** it imports the constant, and the rendered values are identical to every other screen
