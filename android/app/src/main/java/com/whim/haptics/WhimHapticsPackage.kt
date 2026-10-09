package com.whim.haptics

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * Registers the in-repo WhimHaptics TurboModule (design-system-v1 D11). Added to
 * MainApplication's package list: it lives in this app, not node_modules, so it cannot autolink.
 */
class WhimHapticsPackage : BaseReactPackage() {

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == WhimHapticsModule.NAME) WhimHapticsModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
    ReactModuleInfoProvider {
      mapOf(
        WhimHapticsModule.NAME to ReactModuleInfo(
          WhimHapticsModule.NAME, // name
          WhimHapticsModule.NAME, // className
          false, // canOverrideExistingModule
          false, // needsEagerInit
          false, // isCxxModule
          true, // isTurboModule
        ),
      )
    }
}
