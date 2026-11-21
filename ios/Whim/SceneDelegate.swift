import UIKit
import React

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate else {
      return
    }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    let launchOptions = Self.launchOptions(from: connectionOptions)
    appDelegate.startReactNative(in: window, launchOptions: launchOptions)
  }

  // A link that arrives while the app runs. Since React Native 0.88 the linking manager's
  // `application(...)` entry points do nothing in a scene-based app, so these use its scene ones.
  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    RCTLinkingManager.scene(scene, continue: userActivity)
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    RCTLinkingManager.scene(scene, openURLContexts: URLContexts)
  }

  private static func launchOptions(
    from connectionOptions: UIScene.ConnectionOptions
  ) -> [UIApplication.LaunchOptionsKey: Any]? {
    if let userActivity = connectionOptions.userActivities.first(
      where: { $0.activityType == NSUserActivityTypeBrowsingWeb && $0.webpageURL != nil }
    ) {
      return [
        UIApplication.LaunchOptionsKey.userActivityDictionary: [
          UIApplication.LaunchOptionsKey.userActivityType: userActivity.activityType,
          "UIApplicationLaunchOptionsUserActivityKey": userActivity,
        ],
      ]
    }
    if let context = connectionOptions.urlContexts.first {
      return [UIApplication.LaunchOptionsKey.url: context.url]
    }
    return nil
  }
}
