package com.whim.tone

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import com.google.android.play.agesignals.AgeSignalsManagerFactory
import com.google.android.play.agesignals.AgeSignalsRequest
import com.google.android.play.agesignals.AgeSignalsResult
import com.google.android.play.agesignals.model.AgeSignalsVerificationStatus

/**
 * WhimAgeSignal — Play Age Signals, reduced on the phone (legal-surface-v2 D11; spec
 * store-age-signals). `check` resolves one of `adult`, `minor-approved`, `minor-not-approved`,
 * `under-13` or `unavailable`, and nothing else: Play's age range and approval dates stay inside
 * this class.
 *
 * A supervised account (any SUPERVISED* status) whose age range has an upper bound below 13 is
 * `under-13`, whatever a parent approved; that is checked first. Otherwise Play's user status maps
 * as: VERIFIED (Play verified the user is 18+) → `adult`; SUPERVISED (a parent manages the account
 * and has approved what is pending) → `minor-approved`; SUPERVISED_APPROVAL_PENDING and
 * SUPERVISED_APPROVAL_DENIED (the parent hasn't approved, or refused) → `minor-not-approved`;
 * UNKNOWN, no status (a region the law doesn't cover), any status this library version adds, no
 * Play Store, and any error → `unavailable`. It never rejects.
 * Lives in `com.whim.tone` because that is the codegen `javaPackageName` for every in-app spec.
 */
@ReactModule(name = WhimAgeSignalModule.NAME)
class WhimAgeSignalModule(reactContext: ReactApplicationContext) : NativeWhimAgeSignalSpec(reactContext) {

  override fun getName(): String = NAME

  override fun check(promise: Promise) {
    try {
      AgeSignalsManagerFactory.create(reactApplicationContext)
        .checkAgeSignals(AgeSignalsRequest.builder().build())
        .addOnSuccessListener { result -> promise.resolve(reduce(result)) }
        .addOnFailureListener { promise.resolve(UNAVAILABLE) }
    } catch (error: Exception) {
      // No Play Store, or a library that can't start: the same as no signal.
      promise.resolve(UNAVAILABLE)
    }
  }

  // The significant-change acknowledgment is Apple's (beta-1 D2). Play has no such API, so it is
  // never required here and always unavailable.
  override fun requiresSignificantUpdateAcknowledgment(promise: Promise) {
    promise.resolve(false)
  }

  override fun acknowledgeSignificantUpdate(description: String, promise: Promise) {
    promise.resolve(UNAVAILABLE)
  }

  // AgeSignalsResult.userStatus() is declared to return the AgeSignalsVerificationStatus
  // @IntDef annotation type itself rather than the int it annotates (a beta0.0.1-beta01 API
  // quirk), while the VERIFIED/SUPERVISED/... constants are plain Ints — so the raw status has
  // to be unboxed before it can be compared against them.
  private fun reduce(result: AgeSignalsResult): String {
    val status = result.userStatus() as? Int
    if (status in SUPERVISED_STATUSES && isUnder13(result)) return "under-13"
    return when (status) {
      AgeSignalsVerificationStatus.VERIFIED -> "adult"
      AgeSignalsVerificationStatus.SUPERVISED -> "minor-approved"
      AgeSignalsVerificationStatus.SUPERVISED_APPROVAL_PENDING,
      AgeSignalsVerificationStatus.SUPERVISED_APPROVAL_DENIED -> "minor-not-approved"
      else -> UNAVAILABLE
    }
  }

  // Play gives a supervised account an age range (0–12, 13–15, 16–17). A range this library
  // version can't read falls through to the approval mapping rather than failing the check.
  private fun isUnder13(result: AgeSignalsResult): Boolean =
    try {
      result.ageUpper() in 0 until 13
    } catch (error: RuntimeException) {
      false
    }

  companion object {
    const val NAME = "WhimAgeSignal"
    private const val UNAVAILABLE = "unavailable"
    private val SUPERVISED_STATUSES = setOf(
      AgeSignalsVerificationStatus.SUPERVISED,
      AgeSignalsVerificationStatus.SUPERVISED_APPROVAL_PENDING,
      AgeSignalsVerificationStatus.SUPERVISED_APPROVAL_DENIED,
    )
  }
}
