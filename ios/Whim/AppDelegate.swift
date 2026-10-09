import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    true
  }

  /// UIKit creates the window through SceneDelegate. The application delegate retains both
  /// objects because RCTReactNativeFactory holds its delegate weakly.
  func startReactNative(
    in window: UIWindow,
    launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) {
    let factory: RCTReactNativeFactory
    if let existingFactory = reactNativeFactory {
      // RCTRootViewFactory keeps its bridgeless ReactHost and its JS runtime after the first
      // start. Reattaching a scene creates a fresh surface without creating another runtime.
      factory = existingFactory
    } else {
      let delegate = ReactNativeDelegate()
      let newFactory = RCTReactNativeFactory(delegate: delegate)
      delegate.dependencyProvider = RCTAppDependencyProvider()
      reactNativeDelegate = delegate
      reactNativeFactory = newFactory
      factory = newFactory
    }

    factory.startReactNative(
      withModuleName: "Whim",
      in: window,
      launchOptions: launchOptions
    )

    // Launch wiring (design D10, design-system-v1 D12): the root background is the scheme's `bg`
    // (the LaunchBackground colour follows the phone's appearance), and a copy of the launch screen
    // covers the window until the launcher draws Home, so the storyboard hands off to Home's first
    // frame with no white or black frame between.
    window.rootViewController?.view.backgroundColor = UIColor(named: "LaunchBackground")
    WhimLaunchScreenOverlay.cover(window)
  }

  // Universal-link cold start / foreground handoff (specs/app-links "The iOS app delivers
  // universal links to the launcher"): both forward to RCTLinkingManager, which re-emits them
  // through Linking.getInitialURL() / the "url" event for the JS launcher to read.
  func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
  }

  func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    RCTLinkingManager.application(app, open: url, options: options)
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
