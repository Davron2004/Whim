## ADDED Requirements

### Requirement: Host observation channels are unreachable from the candidate realm

The harness SHALL ensure that every host-side channel it opens for observation or capability dispatch is unreachable **as a capability** from the candidate's opaque-origin sandboxed realm — not merely undefined by name. A channel whose name has been deleted from the sandbox realm's global while the underlying binding machinery remains reachable there SHALL NOT be considered isolated, because candidate code can restore the name from that machinery in one call.

The harness SHALL establish the provenance of a frame arriving at its host relay rather than accepting the frame's own claim to be trusted. A frame SHALL be attributable to the main frame before it is treated as a nonce-authenticated observation; the outer page's nonce check governs which frames it posts, and the harness SHALL NOT treat a frame that never transited the outer page as though it had.

An authenticated containment verdict, once observed, SHALL NOT be silently replaceable by a later frame. The harness SHALL NOT resolve competing verdicts by last-writer-wins, because that converts any writable channel into a verdict override.

The harness's own suite SHALL assert capability-level unreachability for each such channel, and that assertion SHALL fail — naming the reachable channel — while any channel remains reachable.

#### Scenario: The relay cannot be re-acquired from inside the sandbox

- **WHEN** candidate code inside the opaque-origin sandboxed realm attempts to restore the host relay binding from the underlying binding machinery and post a frame claiming to be trusted
- **THEN** the frame does not reach the harness's observation state, and the run's containment verdict is unaffected by it

#### Scenario: Host syscall dispatch cannot be reached from inside the sandbox

- **WHEN** candidate code inside the opaque-origin sandboxed realm hand-rolls a syscall frame to the host dispatch channel, bypassing the sandbox-side syscall shim and its generation fence
- **THEN** the call is refused, no host capability is invoked, and no syscall is recorded host-side as legitimate

#### Scenario: An observed verdict is not overridden by a later frame

- **WHEN** a nonce-authenticated `probes` frame has established a containment verdict and a later frame reports a different verdict
- **THEN** the run's verdict is not silently replaced by the later frame
