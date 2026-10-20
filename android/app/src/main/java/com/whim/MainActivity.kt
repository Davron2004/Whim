package com.whim

import android.content.res.Configuration
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.view.ViewTreeObserver
import android.view.WindowInsetsController
import android.view.WindowManager
import android.view.inspector.WindowInspector
import androidx.core.view.WindowInsetsControllerCompat
import com.facebook.fbreact.specs.NativeDeviceInfoSpec
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.swmansion.rnscreens.fragment.restoration.RNScreensFragmentFactory
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
    window.decorView.viewTreeObserver.addOnPreDrawListener {
      mirrorBarAppearance()
      true
    }
  }

  // A React Native `Modal` (the shell's sheets and menus) is a dialog window of its own, drawn over
  // both system bars, so while one is up it decides the bars' icon colour. React Native copies the
  // activity's appearance into the dialog once, when it shows it, and never again: a scheme change
  // while a sheet is up left the sheet's bars in the old scheme (issue #189). Every change of the
  // activity's own appearance (the JS `StatusBar`'s style, the navigation bar's in
  // `onConfigurationChanged`) schedules a traversal of its window, so this pre-draw check sees it and
  // hands it on to every dialog window of this activity.
  private var mirroredAppearance: Int? = null

  private fun mirrorBarAppearance() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
    val appearance = (window.insetsController ?: return).systemBarsAppearance and BAR_APPEARANCE
    if (appearance == mirroredAppearance) return
    mirroredAppearance = appearance
    val token = window.attributes.token
    for (root in WindowInspector.getGlobalWindowViews()) {
      if (root === window.decorView) continue
      if ((root.layoutParams as? WindowManager.LayoutParams)?.token !== token) continue
      root.windowInsetsController?.setSystemBarsAppearance(appearance, BAR_APPEARANCE)
    }
  }

  // The app follows the phone's appearance. `uiMode` is a handled config change (the manifest's
  // configChanges), so the activity isn't recreated when the phone switches: React Native updates
  // `Appearance`, but the navigation bar's icon colour (set from the night mode when edge to edge
  // starts) and the window background (the theme's `launch_background`) are re-read here, so the
  // icons stay legible over the scheme's `bg`. The status bar's icons are the JS `StatusBar`'s.
  // `fontScale` is handled too (issue #201: recreating the activity closed a running app and lost
  // its state). React Native re-measures text at the new scale here, but its DeviceInfo module
  // re-reads the font scale for JS (`Dimensions`, `useWindowDimensions().fontScale`) only when the
  // host resumes, which a change made while Whim stays in front (split screen) never does; its
  // resume hook is exactly that re-read, and tells JS only when the scale changed. It runs after
  // the next layout, once the React surface has re-measured with the new scale: a screen JS
  // rebuilds before that is laid out at the old one, its text boxes keeping the old height.
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    val night = (newConfig.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    WindowInsetsControllerCompat(window, window.decorView).isAppearanceLightNavigationBars = !night
    window.setBackgroundDrawable(ColorDrawable(getColor(R.color.launch_background)))
    window.decorView.viewTreeObserver.addOnGlobalLayoutListener(
        object : ViewTreeObserver.OnGlobalLayoutListener {
          override fun onGlobalLayout() {
            window.decorView.viewTreeObserver.removeOnGlobalLayoutListener(this)
            val react = (application as ReactApplication).reactHost?.currentReactContext
            (react?.getNativeModule(NativeDeviceInfoSpec.NAME) as? LifecycleEventListener)?.onHostResume()
          }
        }
    )
  }

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

  private companion object {
    const val BAR_APPEARANCE =
        WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
            WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
  }
}
