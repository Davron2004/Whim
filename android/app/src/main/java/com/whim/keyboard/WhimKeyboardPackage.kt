package com.whim.keyboard

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * Registers the in-repo WhimKeyboard TurboModule (design-system-v1 F1). Added to
 * MainApplication's package list: it lives in this app, not node_modules, so it cannot autolink.
 */
class WhimKeyboardPackage : BaseReactPackage() {

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == WhimKeyboardModule.NAME) WhimKeyboardModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
    ReactModuleInfoProvider {
      mapOf(
        WhimKeyboardModule.NAME to ReactModuleInfo(
          WhimKeyboardModule.NAME, // name
          WhimKeyboardModule.NAME, // className
          false, // canOverrideExistingModule
          false, // needsEagerInit
          false, // isCxxModule
          true, // isTurboModule
        ),
      )
    }
}
