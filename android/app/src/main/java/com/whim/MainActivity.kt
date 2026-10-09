package com.whim

import android.content.res.Configuration
import android.graphics.drawable.ColorDrawable
import androidx.core.view.WindowInsetsControllerCompat
import com.facebook.react.ReactActivity
import com.facebook.react.ReactApplication
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.swmansion.rnscreens.fragment.restoration.RNScreensFragmentFactory
import com.whim.keyboard.KeyboardFrameReporter
import com.whim.launch.LaunchScreen

class MainActivity : ReactActivity() {

  // Launch wiring (design D10, design-system-v1 D12): the manifest sets this activity's theme to
  // Theme.Whim.Launch so the ember on the scheme's `bg` shows with no flash on cold start. Switch to
  // AppTheme before the superclass inflates the RN content view, so the launcher's own screens
  // render normally; LaunchScreen keeps the launch screen up until Home's first frame.
  // react-native-screens' fragment factory drops the stack screens Android tries to restore after
  // the process was killed in the background, so that restore can't crash.
  override fun onCreate(savedInstanceState: android.os.Bundle?) {
    supportFragmentManager.fragmentFactory = RNScreensFragmentFactory()
    setTheme(R.style.AppTheme)
    super.onCreate(savedInstanceState)
    LaunchScreen.hold(this)
    keyboardFrames.attach()
  }

  // The app follows the phone's appearance. `uiMode` is a handled config change (the manifest's
  // configChanges), so the activity isn't recreated when the phone switches: React Native updates
  // `Appearance`, but the navigation bar's icon colour (set from the night mode when edge to edge
  // starts) and the window background (the theme's `launch_background`) are re-read here, so the
  // icons stay legible over the scheme's `bg`. The status bar's icons are the JS `StatusBar`'s.
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    val night = (newConfig.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    WindowInsetsControllerCompat(window, window.decorView).isAppearanceLightNavigationBars = !night
    window.setBackgroundDrawable(ColorDrawable(getColor(R.color.launch_background)))
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
