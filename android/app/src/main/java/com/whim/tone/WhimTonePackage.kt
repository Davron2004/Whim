package com.whim.tone

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * Registers the app's in-repo TurboModules: WhimTone (effects-and-cues D6) and WhimAppInfo
 * (request-envelope D2). New-architecture package shape: a BaseReactPackage that hands back each
 * module by name and advertises it as a TurboModule in its ReactModuleInfoProvider. Added to
 * MainApplication's package list (it cannot be autolinked — it is in-app, not a node_modules
 * library).
 */
class WhimTonePackage : BaseReactPackage() {

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    when (name) {
      WhimToneModule.NAME -> WhimToneModule(reactContext)
      WhimAppInfoModule.NAME -> WhimAppInfoModule(reactContext)
      else -> null
    }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
    ReactModuleInfoProvider {
      mapOf(
        WhimToneModule.NAME to ReactModuleInfo(
          WhimToneModule.NAME, // name
          WhimToneModule.NAME, // className
          false, // canOverrideExistingModule
          false, // needsEagerInit
          false, // isCxxModule
          true, // isTurboModule
        ),
        WhimAppInfoModule.NAME to ReactModuleInfo(
          WhimAppInfoModule.NAME, // name
          WhimAppInfoModule.NAME, // className
          false, // canOverrideExistingModule
          false, // needsEagerInit
          false, // isCxxModule
          true, // isTurboModule
        ),
      )
    }
}
