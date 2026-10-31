package com.whim.launch

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * Registers the in-repo WhimLaunchScreen TurboModule (design-system-v1 D12). Added to
 * MainApplication's package list: it lives in this app, not node_modules, so it cannot autolink.
 */
class WhimLaunchScreenPackage : BaseReactPackage() {

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == WhimLaunchScreenModule.NAME) WhimLaunchScreenModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
    ReactModuleInfoProvider {
      mapOf(
        WhimLaunchScreenModule.NAME to ReactModuleInfo(
          WhimLaunchScreenModule.NAME, // name
          WhimLaunchScreenModule.NAME, // className
          false, // canOverrideExistingModule
          false, // needsEagerInit
          false, // isCxxModule
          true, // isTurboModule
        ),
      )
    }
}
