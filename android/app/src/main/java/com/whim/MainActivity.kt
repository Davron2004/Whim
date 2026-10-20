package com.whim

import android.content.res.Configuration
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.util.Log
import android.view.View
import android.view.ViewTreeObserver
import android.view.WindowInsetsController
import android.view.WindowManager
import android.view.inspector.WindowInspector
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
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
    fontScale = resources.configuration.fontScale
    LaunchScreen.hold(this)
    window.decorView.viewTreeObserver.addOnPreDrawListener {
      mirrorBarAppearance()
      true
    }
  }

  // A React Native `Modal` (the shell's sheets and menus) is a dialog window of its own, drawn over
  // both system bars, so while one is up it decides the bars' icon colour. React Native copies the
  // activity's appearance into the dialog once, when it shows it, and never again (and from API 31
  // only the status bar's): a scheme change while a sheet is up left the sheet's bars in the old
  // scheme (issue #189). Every change of the activity's own appearance (the JS `StatusBar`'s style,
  // the navigation bar's in `onConfigurationChanged`) schedules a traversal of its window, so this
  // pre-draw check sees it and hands it on to every dialog window of this activity; a dialog
  // showing takes the activity's focus, so `onWindowFocusChanged` hands the whole appearance, both
  // bars, to a new one. Dialog windows can be listed only from API 29 (`WindowInspector`); on 24–28
  // a sheet keeps the bar colours it showed with until it closes, an accepted gap.
  private var mirroredAppearance: Int? = null

  private fun mirrorBarAppearance() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    val appearance =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          (window.insetsController ?: return).systemBarsAppearance and BAR_APPEARANCE
        } else {
          @Suppress("DEPRECATION") (window.decorView.systemUiVisibility and LIGHT_BAR_FLAGS)
        }
    if (appearance == mirroredAppearance) return
    mirroredAppearance = appearance
    val token = window.attributes.token
    for (root in WindowInspector.getGlobalWindowViews()) {
      if (root === window.decorView) continue
      if ((root.layoutParams as? WindowManager.LayoutParams)?.token !== token) continue
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        root.windowInsetsController?.setSystemBarsAppearance(appearance, BAR_APPEARANCE)
      } else {
        @Suppress("DEPRECATION")
        root.systemUiVisibility = (root.systemUiVisibility and LIGHT_BAR_FLAGS.inv()) or appearance
      }
    }
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (!hasFocus) {
      mirroredAppearance = null
      mirrorBarAppearance()
    }
  }

  // The app follows the phone's appearance. `uiMode` is a handled config change (the manifest's
  // configChanges), so the activity isn't recreated when the phone switches: React Native updates
  // `Appearance`, but the navigation bar's icon colour (set from the night mode when edge to edge
  // starts) and the window background (the theme's `launch_background`) are re-read here, so the
  // icons stay legible over the scheme's `bg`. The status bar's icons are the JS `StatusBar`'s.
  // `fontScale` is handled too (issue #201: recreating the activity closed a running app and lost
  // its state). React Native requests a re-measure of its surface here, and the surface takes the
  // new scale into its layout only when that measure runs; JS must get the new scale
  // (`Dimensions`, `useWindowDimensions().fontScale`) after it, or a screen JS rebuilds is laid out
  // at the old scale, its text boxes keeping the old height. JS gets it from the DeviceInfo
  // module's resume hook, which re-reads the scale and tells JS only when it changed:
  // - Whim in front (split screen): no resume comes, so the hook runs after the next layout.
  // - Whim in the background (the Settings app): the change arrives before `onResume`, whose
  //   `super` runs the hook at once, so `onResume` measures the window first.
  private var fontScale = 0f
  private var measureBeforeResume = false

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    val night = (newConfig.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    WindowInsetsControllerCompat(window, window.decorView).isAppearanceLightNavigationBars = !night
    window.setBackgroundDrawable(ColorDrawable(getColor(R.color.launch_background)))
    if (newConfig.fontScale == fontScale) return
    fontScale = newConfig.fontScale
    if (!lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
      measureBeforeResume = true
      return
    }
    window.decorView.viewTreeObserver.addOnGlobalLayoutListener(
        object : ViewTreeObserver.OnGlobalLayoutListener {
          override fun onGlobalLayout() {
            window.decorView.viewTreeObserver.removeOnGlobalLayoutListener(this)
            rereadFontScaleForJs()
          }
        }
    )
  }

  override fun onResume() {
    if (measureBeforeResume) {
      measureBeforeResume = false
      val root = window.decorView
      if (root.width > 0 && root.height > 0) {
        root.measure(
            View.MeasureSpec.makeMeasureSpec(root.width, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(root.height, View.MeasureSpec.EXACTLY),
        )
        root.layout(root.left, root.top, root.right, root.bottom)
      }
    }
    super.onResume()
  }

  private fun rereadFontScaleForJs() {
    val react = (application as ReactApplication).reactHost?.currentReactContext ?: return
    val deviceInfo = react.getNativeModule(NativeDeviceInfoSpec.NAME)
    if (deviceInfo is LifecycleEventListener) {
      deviceInfo.onHostResume()
    } else {
      Log.w(
          TAG,
          "React Native's ${NativeDeviceInfoSpec.NAME} module is $deviceInfo, not a LifecycleEventListener: " +
              "JS keeps the old font scale until Whim next resumes. Re-check this re-read after a React Native upgrade.",
      )
    }
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
    const val TAG = "Whim"
    const val BAR_APPEARANCE =
        WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
            WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
    @Suppress("DEPRECATION")
    const val LIGHT_BAR_FLAGS =
        View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
  }
}
