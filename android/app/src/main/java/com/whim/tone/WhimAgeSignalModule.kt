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
 * store-age-signals). `check` resolves one of `adult`, `minor-approved`, `minor-not-approved` or
 * `unavailable`, and nothing else: Play's age range and approval dates stay inside this class.
 *
 * Play's user status maps as: VERIFIED (Play verified the user is 18+) → `adult`; SUPERVISED (a
 * parent manages the account and has approved what is pending) → `minor-approved`;
 * SUPERVISED_APPROVAL_PENDING and SUPERVISED_APPROVAL_DENIED (the parent hasn't approved, or
 * refused) → `minor-not-approved`; UNKNOWN, no status (a region the law doesn't cover), any status
 * this library version adds, no Play Store, and any error → `unavailable`. It never rejects.
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

  // AgeSignalsResult.userStatus() is declared to return the AgeSignalsVerificationStatus
  // @IntDef annotation type itself rather than the int it annotates (a beta0.0.1-beta01 API
  // quirk), while the VERIFIED/SUPERVISED/... constants are plain Ints — so the raw status has
  // to be unboxed before it can be compared against them.
  private fun reduce(result: AgeSignalsResult): String =
    when (result.userStatus() as? Int) {
      AgeSignalsVerificationStatus.VERIFIED -> "adult"
      AgeSignalsVerificationStatus.SUPERVISED -> "minor-approved"
      AgeSignalsVerificationStatus.SUPERVISED_APPROVAL_PENDING,
      AgeSignalsVerificationStatus.SUPERVISED_APPROVAL_DENIED -> "minor-not-approved"
      else -> UNAVAILABLE
    }

  companion object {
    const val NAME = "WhimAgeSignal"
    private const val UNAVAILABLE = "unavailable"
  }
}
