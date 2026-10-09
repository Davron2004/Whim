# iOS scene startup correction

## Evidence and scope

On 2026-09-18, the primary task reproduced the installed normal Release build's
startup crash on iPhone 18 Pro, iOS 27.0, simulator
`B93A4639-F5DD-450B-BCA2-83C75D1118DF`. Process 96195 logged the same mandatory
UIScene lifecycle failure recorded in `ios27-startup-issue.md`. Current source
still creates its window in AppDelegate and has no scene manifest. This failure
precedes React Native and is not evidence of a TextDecoder failure.

Continue the existing `integration/store-launch` run. Limit implementation to
the native startup/link lifecycle and its release validation. Keep the existing
Hermes initialization, native WebView restrictions, identities, and dependencies.

## Required behavior

- Declare one UIWindowScene configuration with multiple scenes disabled. Create
  its UIWindow from the connected scene and start the existing RN factory there.
- Retain the RN factory and delegate for their required lifetime. Preserve the
  existing launch background and avoid duplicate runtimes on scene reconnection.
- Translate scene connection URL/user-activity inputs into the RN launch options
  consumed by Linking.getInitialURL(). Forward warm scene callbacks through
  RCTLinkingManager. Preserve the complete URL and existing app-delegate routes.
- Include any new Swift file in the Whim Sources phase using the existing
  xcodeproj gem procedure in handoff/ios-project.md.
- Extend the portable iOS project checks with negative cases for missing/wrong
  scene declarations and source membership. Cover cold/warm callback wiring and
  report which checks are structural; a source scan cannot prove native behavior.
- Build and run the normal Release artifact on iOS 27. Open seeded mini-apps,
  exercise one interaction, return Home, and reopen saved data after process
  restart. More than five seconds of mini-app loading is a failure to investigate.

## Validation ownership

The implementer runs targeted release checks and the fast gate in its isolated
worktree, then commits and reports. The primary task builds and operates the
simulator and records observed timing. Native universal-link acceptance needs a
working associated domain or an explicitly identified local test; do not claim
that a wiring test proves OS association. Physical-device and full network-deny
acceptance remain separately tracked in the existing release tasks.

No harness, dependency, entitlement, WebView-policy, or Android changes belong
to this correction. Stop and report if a further defect needs a wider scope.
