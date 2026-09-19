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

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    RCTLinkingManager.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in }
    )
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      RCTLinkingManager.application(
        UIApplication.shared,
        open: context.url,
        options: Self.applicationOpenOptions(from: context.options)
      )
    }
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

  private static func applicationOpenOptions(
    from sceneOptions: UIScene.OpenURLOptions
  ) -> [UIApplication.OpenURLOptionsKey: Any] {
    var options: [UIApplication.OpenURLOptionsKey: Any] = [
      .annotation: sceneOptions.annotation,
      .openInPlace: sceneOptions.openInPlace,
    ]
    if let sourceApplication = sceneOptions.sourceApplication {
      options[.sourceApplication] = sourceApplication
    }
    return options
  }
}
