// ─────────────────────────────────────────────────────────────────────────────
// WhimAgeSignal — Apple's Declared Age Range, reduced on the phone (legal-surface-v2 D11; spec
// store-age-signals). `WhimAgeSignalModule.mm` calls `check(presenting:completion:)` for the
// WhimAgeSignal TurboModule.
// ─────────────────────────────────────────────────────────────────────────────
// Answers one of `adult`, `minor-approved`, `minor-not-approved` or `unavailable`, and nothing
// else: the age range and how it was declared stay inside this function.
//
// • iOS 26.2+ only: that release added `isEligibleForAgeFeatures`, which says whether an age law
//   applies to this user. The store is asked for the range only when it does, so nobody else sees
//   Apple's share-your-age sheet. Older iOS, a user it doesn't apply to, a declined sheet, no
//   presenting screen and any error all answer `unavailable`.
// • One age gate, 18: the least Whim needs to know.
// • Under 18 is `minor-approved`: where these laws apply, the App Store gets a parent's consent
//   before a minor's account can download the app, so a minor running it was approved through the
//   store. A parent withdrawing that consent reaches the developer only as an App Store Server
//   Notification, which Whim does not receive (nothing about age leaves the phone), so iOS never
//   answers `minor-not-approved` today.
//
// DeclaredAgeRange ships with iOS 26 and the app still supports iOS 15.1, so the target
// weak-links it (`-weak_framework DeclaredAgeRange` in OTHER_LDFLAGS) and every use sits behind
// `#available`.
// ─────────────────────────────────────────────────────────────────────────────
import DeclaredAgeRange
import UIKit

@objc(WhimAgeSignalReader)
final class WhimAgeSignalReader: NSObject {
  private static let unavailable = "unavailable"

  /// Asks the store for the user's age signal and calls `completion` once, on the main queue.
  /// `presenter` is the screen Apple's sheet appears over; `nil` answers `unavailable`.
  @objc(checkPresenting:completion:)
  static func check(presenting presenter: UIViewController?, completion: @escaping (String) -> Void) {
    guard #available(iOS 26.2, *), let presenter else {
      completion(unavailable)
      return
    }
    Task { @MainActor in
      completion(await reduced(presenting: presenter))
    }
  }

  @available(iOS 26.2, *)
  @MainActor
  private static func reduced(presenting presenter: UIViewController) async -> String {
    do {
      guard try await AgeRangeService.shared.isEligibleForAgeFeatures else { return unavailable }
      switch try await AgeRangeService.shared.requestAgeRange(ageGates: 18, in: presenter) {
      case .sharing(let range):
        if let lower = range.lowerBound, lower >= 18 { return "adult" }
        if let upper = range.upperBound, upper < 18 { return "minor-approved" }
        return unavailable
      case .declinedSharing:
        return unavailable
      @unknown default:
        return unavailable
      }
    } catch {
      return unavailable
    }
  }
}
