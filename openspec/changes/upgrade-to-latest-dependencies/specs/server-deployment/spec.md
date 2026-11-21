## MODIFIED Requirements

### Requirement: The container image is pinned, minimal, non-root, and secret-free
The repo SHALL provide a multi-stage container build that produces the runtime image on a Node 26 base.

The image SHALL install Chromium through the exact Playwright version the lockfile resolves, into a fixed browsers path. It SHALL contain the production runtime tree and only the server workspace's production dependency closure, with no React, React Native, or other devDependency. It SHALL run as a fixed non-root user, contain no secret value, `.env` file, or credential, and expose only the server port. A deploy-config tripwire in the fast gate SHALL fail in any of these cases: the Playwright version the image installs differs from the lockfile's, the image's user is root, the image copies a `.env` file or sets a secret-named variable to a value, or any deploy artifact disables the Chromium sandbox.

#### Scenario: The browser pin follows the lockfile
- **WHEN** the lockfile's resolved Playwright version and the image definition's Playwright install version are compared
- **THEN** they are equal, and the tripwire fails if either changes alone

#### Scenario: The image runs non-root
- **WHEN** the image definition is inspected
- **THEN** its final user is a fixed non-root uid, and the tripwire fails if the user is root or unset

#### Scenario: No sandbox-disabling flag ships
- **WHEN** every deploy artifact is scanned for `--no-sandbox`, `--disable-setuid-sandbox`, or `chromiumSandbox: false`
- **THEN** none is found
