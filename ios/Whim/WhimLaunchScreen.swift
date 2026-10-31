// ─────────────────────────────────────────────────────────────────────────────
// WhimLaunchScreen — holds the launch screen on a cold start until the launcher draws Home
// (design-system-v1 D12; docs/design/system.md §4.4 M27; specs/app-icon-and-launch "Launch shows
// the ember on the scheme's canvas with no flash").
// ─────────────────────────────────────────────────────────────────────────────
// iOS drops the launch storyboard as soon as the app's window shows, before React Native has
// drawn anything. `cover(_:)` lays a copy of the storyboard (the ember on the `LaunchBackground`
// colour, which follows the phone's appearance) over the window; `hide()`, called by the
// WhimLaunchScreen TurboModule on Home's first frame (`WhimLaunchScreenModule.mm`), fades it out
// over 160 ms. If Home never draws, the cap ends the hold anyway. Main thread only.
// ─────────────────────────────────────────────────────────────────────────────
import UIKit

@objc(WhimLaunchScreenOverlay)
final class WhimLaunchScreenOverlay: NSObject {
  private static let capSeconds: TimeInterval = 3
  private static let fadeSeconds: TimeInterval = 0.16

  private static var covered = false
  private static var overlay: UIView?

  /// Covers `window` with the launch screen. Only the first call (the cold start) covers.
  @objc static func cover(_ window: UIWindow) {
    guard !covered else { return }
    covered = true
    guard let view = UIStoryboard(name: "LaunchScreen", bundle: nil).instantiateInitialViewController()?.view else { return }
    view.frame = window.bounds
    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    window.addSubview(view)
    overlay = view
    DispatchQueue.main.asyncAfter(deadline: .now() + capSeconds) { hide() }
  }

  /// Fades the launch screen out. Later calls do nothing.
  @objc static func hide() {
    guard let view = overlay else { return }
    overlay = nil
    UIView.animate(
      withDuration: fadeSeconds,
      animations: { view.alpha = 0 },
      completion: { _ in view.removeFromSuperview() }
    )
  }
}
