# Android native network deny contract

## Native classes

`com.whim.webview.NetworkDeniedWebViewManager` extends `RNCWebViewManager` and overrides:

```kotlin
override fun createViewInstance(context: ThemedReactContext): RNCWebViewWrapper
```

It calls `super.createViewInstance(context)`, sets
`wrapper.webView.settings.blockNetworkLoads = true`, then returns the wrapper. This order is
fixed: React Native creates a view before applying its properties, so the deny must exist before
the first source can load.

`com.whim.webview.NetworkDeniedWebViewPackage` extends `RNCWebViewPackage` and overrides:

```kotlin
override fun createViewManagers(
  reactContext: ReactApplicationContext,
): List<ViewManager<*, *>>
```

It returns only `NetworkDeniedWebViewManager()`. It inherits the stock package's module provider.

## Application wiring

`MainApplication.reactHost` constructs `PackageList(this).packages` and replaces the autolinked
`RNCWebViewPackage` at its current index. It never appends a second manager. This avoids bridgeless
React Native's last-registered-wins behavior for duplicate manager names.

Startup requires exactly one replacement and throws this message otherwise:

```text
react-native-webview autolinking must provide exactly one RNCWebViewPackage; found $replacedWebViewPackages
```

`WhimTonePackage` remains registered after the replacement.

## Standing check interface

`checks/test/release/native-network-deny.suite.ts` exports:

```ts
interface NativeNetworkDenyFinding {
  readonly file: string;
  readonly message: string;
}

function checkAndroidNativeNetworkDeny(root: string): NativeNetworkDenyFinding[];
function makeNativeNetworkDenyFixture(): string;
function writeNativeNetworkDenyFixture(root: string, relPath: string, content: string): void;
async function run(): Promise<void>;
```

It also exports the three Android source-path constants. The suite checks the real tree, a valid
fixture, and negative fixtures for a retained stock package, a late setting, `false`, and the stock
manager. Chain-17 adds iOS source checks and fixtures to this same suite and `run()` entry point.

## Local negative control

Change exactly this one line without committing it:

```diff
-    wrapper.webView.settings.blockNetworkLoads = true
+    wrapper.webView.settings.blockNetworkLoads = false
```

Rebuild the probe-enabled offline APK, install it over the existing app, and run the canary with
`--expect leak`. The rebuilt app must fetch all six bundles, paint and trust every runnable variant,
and reproduce all five HTTP paths plus TLS. Restore this line and the probe flag byte-for-byte.

## Build evidence

`npm run checks:test` passed 205/205. `./scripts/gate.sh` passed.

Native compile and canary: **NOT RUN**. `./gradlew :app:compileOfflineKotlin` reached
`:app:createBundleOfflineJsAndAssets` first, where Metro could not resolve
`@babel/runtime/helpers/interopRequireDefault` through the worktree's symlinked dependencies.
The prescribed scratch `metro.config.js` and Gradle init script were denied by the protected-config
hook, so no wrapper was created and no bypass was attempted. Run the native build and zero canary
from the primary tree after merge and regate.
