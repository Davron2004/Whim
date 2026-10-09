## ADDED Requirements

### Requirement: Chromium runs with its OS sandbox enabled
The harness SHALL launch Chromium from one launch-options definition with the Chromium OS sandbox enabled, and SHALL NOT pass, or allow Playwright to add, `--no-sandbox`, `--disable-setuid-sandbox`, or any other flag that disables the sandbox, site isolation, or web security.

If Chromium cannot create its sandbox on the host, the launch SHALL fail with a named error. The harness SHALL NOT retry with a weaker configuration, and no environment variable or option SHALL exist that disables the sandbox. The launch-options definition is the only place browser flags are set, and the production boot self-test, the harness suites, and the server all use it.

#### Scenario: The launched browser process carries no sandbox-disabling flag
- **WHEN** a session is launched and the browser process's command-line arguments are inspected
- **THEN** none of `--no-sandbox`, `--disable-setuid-sandbox`, `--disable-web-security`, or `--disable-site-isolation-trials` is present

#### Scenario: No fallback exists
- **WHEN** the harness sources are scanned for a code path that launches Chromium with the sandbox disabled
- **THEN** none is found

### Requirement: A synthetic run has no network egress
No request originating in a synthetic run's browser context SHALL reach any network destination — not the internet, not the host's loopback, not private ranges, not the cloud metadata address. This covers every page, frame, worker, and navigation in the context, and every protocol Chromium can speak (HTTP(S), WebSocket, WebTransport, and WebRTC UDP).

The harness SHALL achieve this with independent layers, each sufficient for HTTP-family traffic on its own:

- **Interception:** the run's page SHALL be delivered from memory by a context-level route at a reserved non-resolvable origin, instead of being written to disk and loaded from `file://`. Every other request and WebSocket the context attempts SHALL be aborted, service workers SHALL be blocked, and downloads SHALL be refused.
- **Dead proxy:** the browser SHALL be launched with all traffic pinned to an unroutable proxy, with the implicit loopback bypass removed, so a request that escaped interception has no route.
- **Resolver and UDP:** host-name resolution SHALL map every name to not-found, and WebRTC SHALL be restricted from non-proxied UDP.

Every aborted attempt SHALL be counted in the run report's trace as the fact and a bounded count, never echoing the attempted URL into diagnostics or model-facing paths. The page's bytes, CSP, nonce handshake, and loader SHALL remain the unmodified production artifacts. Only their delivery changes.

#### Scenario: A hostile candidate reaches no canary
- **WHEN** the harness suite starts a loopback HTTP, WebSocket, and UDP canary, and runs a candidate that attempts every reachable egress path toward it: self-navigation of its frame, an inserted meta refresh, image and CSS URLs, prefetch and preconnect links, WebTransport, and a WebRTC peer connection with the canary as its ICE server
- **THEN** the canaries record zero connections and zero datagrams, and the run report's trace records that egress attempts were blocked

#### Scenario: Interception alone blocks a direct navigation
- **WHEN** a context produced by the harness's context factory is used from the harness side to navigate a page to the canary URL on a browser launched without the proxy pin
- **THEN** the navigation fails and the canary records nothing

#### Scenario: The proxy pin alone blocks a direct navigation
- **WHEN** a browser launched with the harness launch options is given a context with no interception and navigated to the canary URL
- **THEN** the navigation fails and the canary records nothing

#### Scenario: The canary is reachable without the guards
- **WHEN** a separately launched browser with default options and no interception navigates to the canary URL
- **THEN** the canary records the request, proving the other scenarios are not vacuous

#### Scenario: Existing containment behavior is unchanged by the delivery switch
- **WHEN** the harness's existing suite (verdict, relay provenance, forgery, sweep, watchdog, and cancellation tests) runs against in-memory page delivery
- **THEN** every existing test passes unchanged

### Requirement: The candidate build reads nothing from disk but the runtime shim
The harness's candidate builder SHALL resolve no module from the filesystem other than the build's own entry and the production React inject shim. Every import, re-export, or require specifier other than the three host-injected externals (`vc-sdk`, `react`, `react-dom`) SHALL fail the build with a named diagnostic, and no byte of a file it names SHALL appear in the bundle or its source map.

This SHALL hold independently of the static checker, so a gap in either layer alone reopens nothing. A builder change of this kind SHALL keep the existing byte-equivalence tripwire against the production build green.

#### Scenario: A re-exported server file never enters the bundle
- **WHEN** the builder is given a candidate containing `export * from '<absolute path of a repo source file>'` directly, bypassing the checker
- **THEN** the build fails with a named diagnostic, and no content of that file appears in any output

#### Scenario: Honest candidates build byte-identically
- **WHEN** the fixture used by the build-contract drift tripwire is built after the change
- **THEN** its output is byte-identical to the production build pipeline's output

### Requirement: Abort is honoured at every wait in a run
A run given an `AbortSignal` SHALL observe it while waiting for a concurrency slot, before and during page delivery and navigation, while awaiting mount, and during the sweep. It SHALL abandon the run at whichever wait it is in.

A waiter aborted before acquiring a slot SHALL be removed from the queue without ever holding the slot. A run aborted after acquiring one SHALL close its page and browser context and release the slot within 5 seconds of the signal, with no unhandled rejection and no duplicate cleanup.

#### Scenario: An abort while queued never takes the slot
- **WHEN** a concurrency-1 session is running one candidate and a second run is aborted while waiting for the slot
- **THEN** the second run ends without ever opening a browser context, and the first run is unaffected

#### Scenario: An abort during mount releases promptly
- **WHEN** a candidate's mount path hangs and the run is aborted 250 ms after navigation
- **THEN** its browser context is closed and its slot is free within 5 seconds, well before the mount budget would have fired

### Requirement: A crashed browser is replaced
The session SHALL detect that its browser process has disconnected. Every run in progress on the dead browser SHALL end with a named harness error rather than hanging, and the session SHALL launch a replacement browser with the same launch options before the next run opens a context.

A replacement launch that fails SHALL surface as a named error to the run that needed it. The session SHALL retry the launch on a later run rather than staying permanently dead.

#### Scenario: Runs recover after the browser dies
- **WHEN** the session's browser process is killed while one run is in progress and a new run is then started
- **THEN** the in-progress run ends with a named harness error, and the new run completes with a normal report on a freshly launched browser
