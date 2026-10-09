package com.whim.launch

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.module.annotations.ReactModule
import com.whim.tone.NativeWhimLaunchScreenSpec

/**
 * WhimLaunchScreen — the Android half of the in-repo launch-screen TurboModule (design-system-v1
 * D12). `hide` ends [LaunchScreen]'s cold-start hold on the UI thread. The spec class is generated
 * into `com.whim.tone`, the codegen `javaPackageName` of every in-app spec.
 */
@ReactModule(name = WhimLaunchScreenModule.NAME)
class WhimLaunchScreenModule(reactContext: ReactApplicationContext) : NativeWhimLaunchScreenSpec(reactContext) {

  override fun getName(): String = NAME

  override fun hide() {
    UiThreadUtil.runOnUiThread { LaunchScreen.release() }
  }

  companion object {
    const val NAME = "WhimLaunchScreen"
  }
}
