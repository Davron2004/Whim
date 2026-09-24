package com.whim.tone

import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import com.whim.BuildConfig

/**
 * WhimAppInfo — the installed app's marketing version and build number (request-envelope D2),
 * read from this package's PackageInfo: `versionName` and `longVersionCode`. Gradle injects the
 * build number at release time (`-PwhimBuildNumber`), so only the installed binary knows it.
 * Both cross to JS as the raw strings the OS reports; `src/host/launcher/app-info.ts` validates
 * them. A null `versionName` crosses as "", which that wrapper rejects as missing. `internalBuild`
 * is the build type's `WHIM_INTERNAL_BUILD` field (app/build.gradle): true for `debug` and
 * `offline`, false for the `release` store build (legal-surface-v2 D10). Lives in
 * `com.whim.tone` because that is the codegen `javaPackageName` for every in-app spec.
 */
@ReactModule(name = WhimAppInfoModule.NAME)
class WhimAppInfoModule(reactContext: ReactApplicationContext) : NativeWhimAppInfoSpec(reactContext) {

  override fun getName(): String = NAME

  override fun getTypedExportedConstants(): Map<String, Any> {
    val info = installedPackageInfo()
    return mapOf(
      "version" to (info.versionName ?: ""),
      "build" to versionCodeOf(info).toString(),
      "internalBuild" to BuildConfig.WHIM_INTERNAL_BUILD,
    )
  }

  private fun installedPackageInfo(): PackageInfo {
    val context = reactApplicationContext
    val packageManager = context.packageManager
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      packageManager.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(0))
    } else {
      @Suppress("DEPRECATION")
      packageManager.getPackageInfo(context.packageName, 0)
    }
  }

  private fun versionCodeOf(info: PackageInfo): Long =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      info.longVersionCode
    } else {
      @Suppress("DEPRECATION")
      info.versionCode.toLong()
    }

  companion object {
    const val NAME = "WhimAppInfo"
  }
}
