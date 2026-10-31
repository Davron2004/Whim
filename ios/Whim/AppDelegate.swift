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
    WhimStatusBar.install()
    return true
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
  override func createRootViewController() -> UIViewController {
    WhimRootViewController()
  }

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

/// The status bar the shell's `<StatusBar barStyle>` asks for (design-system-v1, #218).
///
/// React Native's StatusBar module sets the style app-wide (`UIApplication.setStatusBarStyle`), which
/// a scene-based app on iOS 27 ignores: measured on the simulator, the setter changed nothing, the
/// getter stayed `.default`, and the bar was whatever the view controllers answered when UIKit last
/// asked. Under a sheet (an over-full-screen React Native `Modal`) that is the modal's controller at
/// presentation, which answered with the style showing then; so a sheet opened in dark mode kept white
/// text over the light scrim after the phone turned light, until it closed, and asking again changed
/// nothing while the app did not adopt view-controller-based appearance.
///
/// So the app adopts it (Info.plist `UIViewControllerBasedStatusBarAppearance`), the module's
/// `setStyle` and `setHidden` record what the shell asked for here and have every controller on screen
/// ask again, and the root and every `Modal` answer with it. The module's own two methods would log an
/// error under view-controller-based appearance on every call (the StatusBar component calls both on
/// its first update), so neither is left in place.
enum WhimStatusBar {
  /// What the shell asked for last; `.default` (the phone's appearance) and shown before it has.
  private(set) static var style: UIStatusBarStyle = .default
  private(set) static var hidden = false

  private static func makeSetStyle() -> @convention(block) (AnyObject, NSString?, Bool) -> Void {
    return { _, name, animated in
      DispatchQueue.main.async {
        style = styleNamed(name as String? ?? "")
        refresh(animated: animated)
      }
    }
  }

  private static func makeSetHidden() -> @convention(block) (AnyObject, Bool, NSString?) -> Void {
    return { _, isHidden, animation in
      DispatchQueue.main.async {
        hidden = isHidden
        refresh(animated: (animation as String? ?? "none") != "none")
      }
    }
  }

  /// Runs once whoever calls `install`, from whichever thread (a `static let` is initialised once).
  private static let installed: Void = {
    let setStyle = makeSetStyle()
    let setHidden = makeSetHidden()
    let answerStyle: @convention(block) (AnyObject) -> Int = { _ in style.rawValue }
    let answerHidden: @convention(block) (AnyObject) -> Bool = { _ in hidden }
    // Every method is replaced on React Native's class alone.
    replace("RCTStatusBarManager", NSSelectorFromString("setStyle:animated:"), setStyle, "v@:@B")
    replace("RCTStatusBarManager", NSSelectorFromString("setHidden:withAnimation:"), setHidden, "v@:B@")
    replace("RCTFabricModalHostViewController", #selector(getter: UIViewController.preferredStatusBarStyle), answerStyle, "q@:")
    replace("RCTFabricModalHostViewController", #selector(getter: UIViewController.prefersStatusBarHidden), answerHidden, "B@:")
  }()

  static func install() {
    _ = installed
  }

  /// Replaces `selector` on the class named `className` with `block`. A class or method React Native
  /// no longer has (after an upgrade) is reported, never passed over in silence.
  private static func replace(_ className: String, _ selector: Selector, _ block: Any, _ types: String) {
    guard let target = NSClassFromString(className) else {
      missing("React Native has no class \(className)")
      return
    }
    guard class_getInstanceMethod(target, selector) != nil else {
      missing("\(className) has no method \(NSStringFromSelector(selector))")
      return
    }
    class_replaceMethod(target, selector, imp_implementationWithBlock(block), types)
  }

  private static func missing(_ what: String) {
    NSLog("Whim status bar: %@, so the shell's status bar is not applied there. Re-check WhimStatusBar after a React Native upgrade.", what)
#if DEBUG
    assertionFailure("Whim status bar: \(what)")
#endif
  }

  /// React Native's `barStyle` names.
  private static func styleNamed(_ name: String) -> UIStatusBarStyle {
    switch name {
    case "dark-content": return .darkContent
    case "light-content": return .lightContent
    default: return .default
    }
  }

  /// Every window's root and each controller it presents, to the top, asks for the style again.
  private static func refresh(animated: Bool) {
    let update = {
      for scene in UIApplication.shared.connectedScenes {
        guard let windowScene = scene as? UIWindowScene else { continue }
        for window in windowScene.windows {
          var controller = window.rootViewController
          while let current = controller {
            current.setNeedsStatusBarAppearanceUpdate()
            controller = current.presentedViewController
          }
        }
      }
    }
    if animated {
      UIView.animate(withDuration: 0.25, animations: update)
    } else {
      update()
    }
  }
}

/// The window's root: its status bar is the one the shell asked for (`WhimStatusBar`), never a
/// react-native-screens screen's.
final class WhimRootViewController: UIViewController {
  override var preferredStatusBarStyle: UIStatusBarStyle { WhimStatusBar.style }
  override var prefersStatusBarHidden: Bool { WhimStatusBar.hidden }
  override var childForStatusBarStyle: UIViewController? { nil }
  override var childForStatusBarHidden: UIViewController? { nil }
}
