package com.whim.haptics

import android.content.Context
import android.media.AudioAttributes
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.view.HapticFeedbackConstants
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.module.annotations.ReactModule
import com.whim.tone.NativeWhimHapticsSpec

/**
 * WhimHaptics — the Android half of the in-repo haptics TurboModule (design-system-v1 D11;
 * docs/design/system.md §5). Shell moments arrive as a `HapticFeedbackConstants` name and play
 * through `View.performHapticFeedback` on the activity's root view, which follows the system
 * touch-feedback setting and needs no permission. The API-34 constants fall back per constant
 * below their API level (the §5 table's fallback column). The iOS generator arguments of
 * `impact`/`notification` are ignored here, and there is nothing to prepare.
 *
 * App cues (`cue`) play `VibrationEffect.createPredefined` (API 29+) as touch feedback, so the
 * same setting silences them. Fire-and-forget: nothing returns or throws back to JS.
 * The spec class is generated into `com.whim.tone`, the codegen `javaPackageName` of every in-app
 * spec.
 */
@ReactModule(name = WhimHapticsModule.NAME)
class WhimHapticsModule(reactContext: ReactApplicationContext) : NativeWhimHapticsSpec(reactContext) {

  override fun getName(): String = NAME

  override fun impact(style: String, intensity: Double, android: String) = perform(android)

  override fun selection(android: String) = perform(android)

  override fun notification(kind: String, android: String) = perform(android)

  override fun prepare(kind: String) {
    // Android's haptic engine needs no warm-up.
  }

  override fun cue(kind: String) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      // No predefined effects before API 29: the nearest view feedback, which follows the setting.
      when (kind) {
        "double" -> {
          performConstant(HapticFeedbackConstants.VIRTUAL_KEY)
          Handler(Looper.getMainLooper()).postDelayed(
            { performConstant(HapticFeedbackConstants.VIRTUAL_KEY) },
            DOUBLE_GAP_MS,
          )
        }
        "heavy" -> performConstant(HapticFeedbackConstants.LONG_PRESS)
        else -> performConstant(HapticFeedbackConstants.VIRTUAL_KEY)
      }
      return
    }
    val effect = when (kind) {
      "double" -> VibrationEffect.EFFECT_DOUBLE_CLICK
      "heavy" -> VibrationEffect.EFFECT_HEAVY_CLICK
      else -> VibrationEffect.EFFECT_CLICK
    }
    try {
      val vibrator = vibrator() ?: return
      if (!vibrator.hasVibrator()) return
      val predefined = VibrationEffect.createPredefined(effect)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        // USAGE_TOUCH: the system applies the touch-feedback setting to it.
        vibrator.vibrate(predefined, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_TOUCH))
      } else if (touchFeedbackEnabled()) {
        @Suppress("DEPRECATION")
        vibrator.vibrate(predefined, SONIFICATION)
      }
    } catch (_: Exception) {
      // A missing or busy vibrator never surfaces to the bundle.
    }
  }

  /** Perform a shell moment's feedback constant, or its fallback below the constant's API level. */
  private fun perform(name: String) {
    val sdk = Build.VERSION.SDK_INT
    val api34 = sdk >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
    val api30 = sdk >= Build.VERSION_CODES.R
    val constant = when (name) {
      "SEGMENT_TICK" -> if (api34) HapticFeedbackConstants.SEGMENT_TICK else HapticFeedbackConstants.CLOCK_TICK
      "TOGGLE_ON" -> if (api34) HapticFeedbackConstants.TOGGLE_ON else HapticFeedbackConstants.CONTEXT_CLICK
      "TOGGLE_OFF" -> if (api34) HapticFeedbackConstants.TOGGLE_OFF else HapticFeedbackConstants.CONTEXT_CLICK
      "GESTURE_THRESHOLD_ACTIVATE" ->
        if (api34) HapticFeedbackConstants.GESTURE_THRESHOLD_ACTIVATE else HapticFeedbackConstants.CONTEXT_CLICK
      "CONFIRM" -> if (api30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
      "REJECT" -> if (api30) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
      "LONG_PRESS" -> HapticFeedbackConstants.LONG_PRESS
      else -> return
    }
    performConstant(constant)
  }

  private fun performConstant(constant: Int) {
    UiThreadUtil.runOnUiThread {
      try {
        reactApplicationContext.currentActivity?.window?.decorView?.performHapticFeedback(constant)
      } catch (_: Exception) {
        // No window (backgrounded) or no haptic engine: the moment passes silently.
      }
    }
  }

  private fun vibrator(): Vibrator? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      reactApplicationContext.getSystemService(VibratorManager::class.java)?.defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      reactApplicationContext.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    }

  /** The touch-feedback setting, read directly before API 33 (later, USAGE_TOUCH applies it). */
  private fun touchFeedbackEnabled(): Boolean =
    @Suppress("DEPRECATION")
    Settings.System.getInt(reactApplicationContext.contentResolver, Settings.System.HAPTIC_FEEDBACK_ENABLED, 1) != 0

  companion object {
    const val NAME = "WhimHaptics"
    private const val DOUBLE_GAP_MS = 80L
    private val SONIFICATION: AudioAttributes =
      AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
  }
}
