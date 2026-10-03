## RENAMED Requirements

- FROM: `### Requirement: Store builds carry no cleartext exception`
- TO: `### Requirement: Store builds permit cleartext only for a user-chosen local server`

## MODIFIED Requirements

### Requirement: Store builds permit cleartext only for a user-chosen local server
The Android `release` build type SHALL permit cleartext traffic only so that a user-chosen local server is reachable, with the launcher's address rule (see `app-launcher`) as the guard: it accepts `http://` only for a loopback or private-range IP literal, `localhost`, a `.local` name or a non-numeric single-label host, and nothing in the launcher sends a request to any other `http://` address.
The iOS app SHALL keep App Transport Security's arbitrary loads disabled, with local networking as its only exception, and SHALL declare a non-empty local-network usage description. Mini-app bundles SHALL stay off the network in every build through the sandbox's content security policy, whatever the platform's cleartext setting.

#### Scenario: A release build reaches a LAN server
- **WHEN** a release build of the Android app has an acknowledged override of `http://10.0.2.2:8787`
- **THEN** requests to that server succeed

#### Scenario: A release build never sends http to a public host
- **WHEN** the user enters `http://api.example.com` or `http://8.8.8.8` as the server address
- **THEN** the launcher refuses to save it, and no request is sent to it
