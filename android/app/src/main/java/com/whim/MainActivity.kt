package com.whim

import com.facebook.react.ReactActivity
import com.facebook.react.ReactApplication
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.swmansion.rnscreens.fragment.restoration.RNScreensFragmentFactory
import com.whim.keyboard.KeyboardFrameReporter

class MainActivity : ReactActivity() {

  // Launch wiring (design D10): the manifest sets this activity's theme to
  // Theme.Whim.Launch so the launch background shows with no flash on cold start. Switch to
  // AppTheme before the superclass inflates the RN content view, so the launcher's own screens
  // render normally. react-native-screens' fragment factory drops the stack screens Android tries to
  // restore after the process was killed in the background, so that restore can't crash.
  override fun onCreate(savedInstanceState: android.os.Bundle?) {
    supportFragmentManager.fragmentFactory = RNScreensFragmentFactory()
    setTheme(R.style.AppTheme)
    super.onCreate(savedInstanceState)
    keyboardFrames.attach()
  }

  override fun onDestroy() {
    keyboardFrames.detach()
    super.onDestroy()
  }

  // A keyboard that changes height while up reaches JS on Android 11+ as well (KeyboardFrameReporter).
  private val keyboardFrames =
      KeyboardFrameReporter(this) { (application as ReactApplication).reactHost?.currentReactContext }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "Whim"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
