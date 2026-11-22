## ADDED Requirements

### Requirement: Each page load of a hosting WebView has its own secret token
The RN host SHALL mint a fresh token of at least 128 bits from a cryptographically secure source for every page load of every WebView that loads the runtime page, and MUST NOT fall back to a guessable value when no secure source is available; without a token, the host accepts no message from that WebView.

#### Scenario: Every page load gets a new token
- **WHEN** a WebView loads the runtime page, then reloads it (a content-process restart, a renderer crash, a remount)
- **THEN** the second load is given a different token, and a message carrying the first load's token is refused

#### Scenario: No secure source, no channel
- **WHEN** the host's cryptographically secure random source is unavailable or throws
- **THEN** no token is minted, no message from that WebView is accepted, and the failure is logged on the host's error channel

### Requirement: The token reaches only the outer page's main frame
The RN host SHALL deliver the token only by script injection into the WebView's main frame after the page has loaded, and the outer page MUST accept the token once per page load, keep it only inside its orchestration closure, and never pass it into the mini-app iframe or any other frame.

#### Scenario: The token is set once
- **WHEN** the outer page has accepted a token and a second token delivery arrives in the same page load
- **THEN** the second delivery is ignored and the first token stays in force

#### Scenario: The mini-app frame never sees the token
- **WHEN** any frame message, init frame, delivery or relay the outer page sends to the mini-app iframe is inspected
- **THEN** none contains the token

### Requirement: The outer page signs every message it sends to RN
The outer page SHALL prefix every message it posts to the native bridge with the current token in one fixed envelope (`W1.<32 lowercase hex>.<JSON>`), for every kind it sends, and before a token arrives it MUST post the same message without a token, keeping its host-log lines in a bounded buffer that it flushes, signed, when the token arrives.

#### Scenario: A signed frame for every kind
- **WHEN** the outer page holds a token and relays a paint, error, probes, delivery, syscall, ui-event, nav-depth, rejected-forgery, host-log, warm-answer or bridge-exposure message
- **THEN** the posted string starts with `W1.` followed by that token and a `.`

#### Scenario: Stub hosts keep working
- **WHEN** the runtime page runs in a host that never delivers a token (the synthetic run, the invariants suites, a desktop test)
- **THEN** every message is posted exactly as before this change, unsigned, and the page's behavior is otherwise unchanged

#### Scenario: Load-time log lines are not lost
- **WHEN** the outer page logs during page load and the token arrives afterwards
- **THEN** the buffered lines reach RN signed, in order, and lines beyond the buffer's bound are counted in one summary line rather than silently dropped

### Requirement: RN drops every unsigned message before reading it
Every RN consumer of a runtime-page WebView's messages SHALL compare the envelope's token with the current page load's token in constant time before parsing or acting on the message, and MUST drop a message that lacks the envelope or carries any other token, whatever its kind; dropped messages are counted, never parsed.

#### Scenario: A token-less message of every kind is dropped
- **WHEN** RN receives a well-formed paint, error, probes, delivery, syscall, ui-event, nav-depth, rejected-forgery, host-log, warm-answer or bridge-exposure message without the envelope
- **THEN** none of them changes any host state (no opening released, no crash screen, no verdict, no syscall dispatched, no back-policy change, no log line), and the drop counter rises by one per message

#### Scenario: A wrong token is dropped
- **WHEN** a message carries a well-formed envelope with a token other than the current page load's
- **THEN** it is dropped exactly like a token-less one

#### Scenario: Every consumer applies the check
- **WHEN** the product pool's slot router, the mini-app host hook, the dev probe screen and the network-deny probe screen each receive an unsigned message
- **THEN** each drops it through the same shared verifier

### Requirement: Native code drops messages from frames other than the main frame
Where the platform reports the sending frame, the native layer SHALL drop a bridge message whose sender is not the main frame before it reaches JavaScript: on Android's web-message-listener path when `isMainFrame` is false, and on iOS when the script message's `frameInfo.isMainFrame` is false.

#### Scenario: A subframe's post never reaches JS
- **WHEN** a subframe that can see the native bridge posts to it on the Android listener path or on iOS
- **THEN** RN's message handler is not invoked for that post

#### Scenario: The fallback path still relies on the token
- **WHEN** the Android WebView lacks `WEB_MESSAGE_LISTENER` and the library uses its `addJavascriptInterface` fallback, which carries no frame identity
- **THEN** the native layer passes the message through, and the token check alone refuses it

#### Scenario: The fallback path is testable on an emulator
- **WHEN** a debug build sets the force-fallback switch
- **THEN** the WebView uses the `addJavascriptInterface` path, and a release build cannot set the switch (a static check fails the gate if it could)

### Requirement: The outer page measures what a navigated frame can reach
After accepting a token, the outer page SHALL run one exposure probe per page load and send RN a signed `bridge-exposure` report whose outcome is exactly one of `refused`, `navigated` or `timedOut`; the result MUST NOT change any containment verdict.

#### Scenario: The probe frame matches the mini-app frame
- **WHEN** the probe runs
- **THEN** a throwaway iframe with the mini-app frame's sandbox attributes and CSP tries to navigate itself to a `data:` document, which reports what bridge objects it can see and posts a fixed canary straight to the native bridge, and the outer page removes the frame afterwards

#### Scenario: The report is recorded per WebView
- **WHEN** the exposure probe finishes, or does not report within its time limit
- **THEN** RN records `{outcome, visible: {android, ios}, canaryReachedNative, webview}` for that page load, logs it on the host's diagnostics channel, shows it on the dev probe screen, and hands it to the diagnostics upload (`device-diagnostics`); no verdict's `contained` changes

#### Scenario: A refused navigation is told apart from a timeout
- **WHEN** the platform refuses the probe frame's navigation (as iOS does under the native subframe refusal)
- **THEN** the probe frame's original realm is still alive after the navigation attempt and reports so, and the outcome is `refused`, not `timedOut`

#### Scenario: The canary is recognized without being parsed
- **WHEN** RN receives the canary string on the bridge
- **THEN** RN recognizes it by exact string equality before the token check, marks `canaryReachedNative` for that page load, and drops it

#### Scenario: Only the probe frame can report exposure
- **WHEN** the mini-app iframe, or any frame other than the current throwaway probe frame, posts an exposure-shaped message to the outer page
- **THEN** the outer page ignores it and sends no `bridge-exposure` report

#### Scenario: Hosts without a token run no exposure probe
- **WHEN** the runtime page runs in a host that delivers no token
- **THEN** no throwaway frame is created
