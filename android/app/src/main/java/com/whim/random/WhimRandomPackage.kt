package com.whim.random

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * Registers the in-repo WhimRandom TurboModule (webview-bridge-provenance D1). Added to
 * MainApplication's package list: it lives in this app, not node_modules, so it cannot autolink.
 */
class WhimRandomPackage : BaseReactPackage() {

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == WhimRandomModule.NAME) WhimRandomModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
    ReactModuleInfoProvider {
      mapOf(
        WhimRandomModule.NAME to ReactModuleInfo(
          WhimRandomModule.NAME, // name
          WhimRandomModule.NAME, // className
          false, // canOverrideExistingModule
          false, // needsEagerInit
          false, // isCxxModule
          true, // isTurboModule
        ),
      )
    }
}
