package com.whim.tone

import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule

/**
 * WhimTone — the in-repo audio-cue TurboModule (effects-and-cues D6). Wraps
 * android.media.ToneGenerator: the host owns the closed token -> (tone, duration) table, so the
 * mini-app bundle expresses only the sound TOKEN ('tick' | 'chime' | 'alarm'), never a raw tone
 * or duration (tokens-not-values, D4). Fire-and-forget (D7): play() never throws back and returns
 * nothing — a cue must not crash the host or expose any sensing surface. No external dependency,
 * no bundled assets; synthesized tones are deliberately modest for v0.3 (tokens insulate later
 * sound design). Extends the codegen-generated NativeWhimToneSpec (new arch / bridgeless).
 */
@ReactModule(name = WhimToneModule.NAME)
class WhimToneModule(reactContext: ReactApplicationContext) : NativeWhimToneSpec(reactContext) {

  override fun getName(): String = NAME

  override fun play(token: String) {
    // token -> (ToneGenerator tone constant, duration ms). Closed-set substitution only (D4):
    // tune for on-device feel here without ever opening the contract's token type.
    val (tone, durationMs) = when (token) {
      "tick" -> Pair(ToneGenerator.TONE_PROP_BEEP, 80)
      "chime" -> Pair(ToneGenerator.TONE_PROP_ACK, 180)
      "alarm" -> Pair(ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD, 750)
      else -> Pair(ToneGenerator.TONE_PROP_BEEP, 80)
    }
    try {
      val generator = ToneGenerator(AudioManager.STREAM_NOTIFICATION, TONE_VOLUME)
      generator.startTone(tone, durationMs)
      // Release shortly after the tone finishes; a fresh generator per cue keeps this stateless.
      Handler(Looper.getMainLooper()).postDelayed(
        {
          try {
            generator.release()
          } catch (_: Exception) {
            // Already released or unavailable; cue cleanup is best-effort.
          }
        },
        (durationMs + RELEASE_GRACE_MS).toLong(),
      )
    } catch (_: Exception) {
      // Fire-and-forget: a busy audio HAL / unavailable stream must never surface to the bundle.
    }
  }

  companion object {
    const val NAME = "WhimTone"
    private const val TONE_VOLUME = 90 // 0..100
    private const val RELEASE_GRACE_MS = 60
  }
}
