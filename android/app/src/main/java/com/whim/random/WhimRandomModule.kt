package com.whim.random

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import com.whim.tone.NativeWhimRandomSpec
import java.security.SecureRandom

/**
 * WhimRandom — the Android half of the secure-random TurboModule (webview-bridge-provenance D1).
 * Hermes has no `crypto` global, so the per-WebView-instance bridge token is minted here from
 * `java.security.SecureRandom`, the OS-seeded CSPRNG. `randomHex` is synchronous and returns
 * `byteCount` bytes as lowercase hex, or null when `byteCount` is not an integer in 1–64 or the
 * random source fails. There is no fallback generator: null means the caller has no token and
 * must fail closed. The spec class is generated into `com.whim.tone`, the codegen
 * `javaPackageName` of every in-app spec.
 */
@ReactModule(name = WhimRandomModule.NAME)
class WhimRandomModule(reactContext: ReactApplicationContext) : NativeWhimRandomSpec(reactContext) {

  override fun getName(): String = NAME

  override fun randomHex(byteCount: Double): String? {
    if (byteCount != Math.floor(byteCount) || byteCount < MIN_BYTES || byteCount > MAX_BYTES) return null
    val bytes = ByteArray(byteCount.toInt())
    return try {
      SECURE_RANDOM.nextBytes(bytes)
      val hex = StringBuilder(bytes.size * 2)
      for (byte in bytes) {
        hex.append(HEX_DIGITS[(byte.toInt() shr 4) and 0x0f])
        hex.append(HEX_DIGITS[byte.toInt() and 0x0f])
      }
      hex.toString()
    } catch (_: RuntimeException) {
      null
    }
  }

  companion object {
    const val NAME = "WhimRandom"
    private const val MIN_BYTES = 1.0
    private const val MAX_BYTES = 64.0
    private const val HEX_DIGITS = "0123456789abcdef"
    private val SECURE_RANDOM = SecureRandom()
  }
}
