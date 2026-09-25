// ─────────────────────────────────────────────────────────────────────────────
// WhimAgeSignal — Apple's Declared Age Range, reduced on the phone (legal-surface-v2 D11; spec
// store-age-signals). `WhimAgeSignalModule.mm` calls `check(presenting:completion:)` for the
// WhimAgeSignal TurboModule.
// ─────────────────────────────────────────────────────────────────────────────
// Answers one of `adult`, `minor-approved`, `under-13` or `unavailable`, and nothing else: the
// age range and how it was declared stay inside this function.
//
// • iOS 26.2+ only: that release added `isEligibleForAgeFeatures`, which says whether an age law
//   applies to this user. The store is asked for the range only when it does, so nobody else sees
//   Apple's share-your-age sheet. Older iOS, a user it doesn't apply to, a declined sheet, no
//   presenting screen and any error all answer `unavailable`.
// • Two age gates, 13 and 18: the least Whim needs to know. A range whose upper bound is below 13
//   is `under-13`, which Whim holds whatever a parent approved.
// • Otherwise under 18 is `minor-approved`: where these laws apply, the App Store gets a parent's
//   consent before a minor's account can download the app, so a minor running it was approved
//   through the store. A parent withdrawing that consent reaches the developer only as an App Store Server
//   Notification, which Whim does not receive (nothing about age leaves the phone), so iOS never
//   answers `minor-not-approved` today.
//
// The significant-change acknowledgment (beta-1 D2): on iOS 26.4+, when the store requires a
// guardian to be told of a significant change, Apple's sheet tells them. The launcher asks for it
// only for an approved minor whose accepted terms are older than the current ones. It is two calls,
// `requiresSignificantUpdateAcknowledgment` and `acknowledgeSignificantUpdate`, so each gets its
// own deadline in JS.
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
      switch try await AgeRangeService.shared.requestAgeRange(ageGates: 13, 18, in: presenter) {
      case .sharing(let range):
        if let upper = range.upperBound, upper < 13 { return "under-13" }
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

  /// Whether the store requires a guardian to be told of a significant app change, via
  /// `completion` once, on the main queue. Older iOS and any error answer `false`.
  @objc(requiresSignificantUpdateAcknowledgment:)
  static func requiresSignificantUpdateAcknowledgment(completion: @escaping (Bool) -> Void) {
    guard #available(iOS 26.4, *) else {
      completion(false)
      return
    }
    Task { @MainActor in
      let features = try? await AgeRangeService.shared.requiredRegulatoryFeatures
      completion(features?.contains(.significantAppChangeRequiresAdultNotification) ?? false)
    }
  }

  /// Shows the guardian Apple's significant-update acknowledgment with `updateDescription`, and
  /// calls `completion` once, on the main queue: `acknowledged` when it returns, `declined` when
  /// the guardian cancels, `unavailable` on older iOS, with no active window scene, or on any
  /// other error.
  @objc(acknowledgeSignificantUpdate:completion:)
  static func acknowledgeSignificantUpdate(_ updateDescription: String, completion: @escaping (String) -> Void) {
    guard #available(iOS 26.4, *) else {
      completion(unavailable)
      return
    }
    Task { @MainActor in
      completion(await acknowledgment(of: updateDescription))
    }
  }

  @available(iOS 26.4, *)
  @MainActor
  private static func acknowledgment(of updateDescription: String) async -> String {
    let scene = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .first { $0.activationState == .foregroundActive }
    guard let scene else { return unavailable }
    do {
      try await AgeRangeService.shared.showSignificantUpdateAcknowledgment(in: scene, updateDescription: updateDescription)
      return "acknowledged"
    } catch is CancellationError {
      return "declined"
    } catch {
      return unavailable
    }
  }
}
