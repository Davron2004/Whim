# Host Object.hasOwn evidence

## Recommendation

Do not require a production response with optional fields set to null.

S3, S4, and S35 change only the membership primitive:
Object.prototype.hasOwnProperty.call(x, key) becomes Object.hasOwn(x, key).
The branch conditions, decoded shapes, fallbacks, and error handling do not
change. The existing Node suite proves every branch semantic. One successful
host decode on each shipping platform proves that the new intrinsic exists and
executes in that platform Hermes runtime.

Requiring every changed callsite to run on a device would add a branch-coverage
policy. It is not required to establish engine compatibility, and the
documented Release path cannot meet it without new infrastructure.

## Existing semantic coverage

src/host/launcher/test/wire-future-frames.suite.ts drives the public
generation-client decoder through server-framed responses.

- Lines 443-492 and 470-492 send optional nulls, including result
  app.sourceMap and summary. They execute S4 withoutNullOptionals and prove
  optional nulls are dropped while required nulls still fail.
- Lines 547-578 send valid and malformed summaries. They execute S3
  isRunSummary and prove valid summary kinds survive while malformed summaries
  are dropped without losing the result.
- Every sseFromServer stream enters known-event dispatch. The normal streams at
  lines 216-221, 417-421, and 470-480 execute S35 isKnownEventType.

These assertions observe decoded events, fallback state, and persisted version
summaries. They are not source-text checks. They run under Node, so they prove
semantics rather than native engine availability.

## Host-engine evidence

generation-client.ts is launcher-host code, not the WebView SDK realm. Metro
packages the same module into Android and iOS, and each target runs it in
Hermes. All three callsites read the same Object.hasOwn intrinsic with plain,
non-null records. A successful changed call in the host proves that Hermes
resolved and invoked the intrinsic. There is no per-branch polyfill, alternate
realm, or special receiver that could make one callsite work while another
lacks Object.hasOwn. The Node suite supplies the distinct data-shape coverage.

After the replacement is built, retain these two source-pinned receipts:

1. Android offline: one successful current-tip local-stub generation. Its
   native host SSE decode executes S35.
2. iOS Release: one successful production generation. Its native host SSE
   decode executes S35.

Each receipt must record candidate SHA/build and successful delivery. S3 does
not need to occur in the production result because its summary is optional.

## Runtime and producer facts

- Android sets hermesEnabled=true in android/gradle.properties:48 and selects
  hermes-android in android/app/build.gradle:237-240.
- iOS locks hermes-engine 250829098.0.10 in ios/Podfile.lock:3-5. React Native
  0.85 enables Hermes by default in scripts/react_native_pods.rb:70-81; the
  vendored Hermes source identifies v0.16.0.
- React Native carries an Object.hasOwn fallback only for supported JSC builds
  in Libraries/Animated/nodes/AnimatedProps.js:357-363. This app targets
  Hermes on both platforms.
- RunMachine.emitDelivery calls summariseDelivery after a deliverable record.
  The configured summary-model role runs in summariseDelivery; emitDelivery
  includes summary only when it is truthy
  (server/src/generation/machine.ts:1036-1047,1070-1082). Timeout, abort,
  unusable prose, and model failure still deliver a result without one.

## Local override boundary

Android offline permits QA override. Its build type sets
WHIM_INTERNAL_BUILD=true in android/app/build.gradle:188-193, and the
documented section-10 path uses Settings plus adb reverse to reach a local
server.

iOS Release deliberately does not permit it. WhimAppInfoModule.mm:28-32 reports
internalBuild=false outside DEBUG, and serverOverride returns undefined for
internalBuild=false in src/host/launcher/server-address.ts:54-72. Release uses
the compiled production URL. Debug iOS remains the internal local-server path.

## Literal-device-coverage fallback

No existing native acceptance helper sends optional nulls. The current stub
does not send them and the null fixture is Node-only. Android offline and iOS
Debug can use a controlled local server through the existing address override,
but iOS Release cannot. A literal all-three Release requirement would need new
test infrastructure or a production-service change. Neither belongs in this
structural Sonar fix.

Use the two real host decodes plus the existing semantic suite as the terminal
evidence. Do not add a production marker or shipping-code seam just to force
device branch coverage.
