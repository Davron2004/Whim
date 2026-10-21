package com.whim

import android.content.res.Configuration
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.Window
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
import com.facebook.react.views.modal.ReactModalHostView
import com.swmansion.rnscreens.fragment.restoration.RNScreensFragmentFactory
import com.whim.launch.LaunchScreen
import java.util.WeakHashMap

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
    clearNavigationBarScrim(window)
    fontScale = resources.configuration.fontScale
    LaunchScreen.hold(this)
    window.decorView.viewTreeObserver.addOnPreDrawListener {
      matchNavigationBarToStatusBar(activityBars)
      mirrorBarAppearance()
      clearDialogNavigationBarScrims()
      true
    }
  }

  // With no scrim (below) the navigation bar shows what is under it, so its icons must read against
  // that. On the activity's window that is the page the status bar is over: Home and the shell's
  // screens in the shell's scheme, a running app's own frame over the app, its crash screen and its
  // launch failure. The JS `StatusBar` sets the status bar for the page shown, so the navigation
  // bar's icons copy the status bar's, before each of the activity's frames (a style change
  // schedules one); never the phone's night mode, or a light frame over a dark phone gets white
  // icons on its light `bg`. On a Modal's dialog window it is the overlay itself (a sheet's surface,
  // or a menu's backdrop over Home), drawn in the shell's scheme, which follows the phone's
  // appearance, while its status bar is over the dimmed page under the overlay. Over a running app
  // whose frame is in the other scheme the two differ, so a dialog's navigation bar takes the
  // shell's scheme (`dialogBarAppearance`) and its status bar the activity's.
  private val activityBars by lazy { WindowInsetsControllerCompat(window, window.decorView) }

  private fun matchNavigationBarToStatusBar(bars: WindowInsetsControllerCompat) {
    val light = bars.isAppearanceLightStatusBars
    if (bars.isAppearanceLightNavigationBars != light) bars.isAppearanceLightNavigationBars = light
  }

  private fun shellSchemeLight(): Boolean =
      (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) != Configuration.UI_MODE_NIGHT_YES

  private fun matchNavigationBarToShellScheme(bars: WindowInsetsControllerCompat) {
    val light = shellSchemeLight()
    if (bars.isAppearanceLightNavigationBars != light) bars.isAppearanceLightNavigationBars = light
  }

  // A React Native `Modal` (the shell's sheets and menus) is a dialog window of its own, drawn over
  // both system bars, so while one is up it decides the bars' icon colour. React Native copies the
  // activity's appearance into the dialog once, when it shows it, and never again (and from API 31
  // only the status bar's): a scheme change while a sheet is up left the sheet's bars in the old
  // scheme (issue #189). Every change of the activity's own appearance (the JS `StatusBar`'s style)
  // schedules a traversal of its window, and so does a change of the phone's appearance (the
  // window background is set again), so this pre-draw check sees either and hands the dialog
  // appearance on to every dialog window of this activity; a dialog showing takes the activity's
  // focus, so `onWindowFocusChanged` hands it, both bars, to a new one. Dialog windows can be listed
  // only from API 29 (`WindowInspector`); on 24–28 a sheet keeps the bar colours it showed with until
  // it closes, an accepted gap.
  private var mirroredAppearance: Int? = null

  /** A dialog's bars: the status bar's icons as the activity's, the navigation bar's in the
   *  shell's scheme. `null` while the activity's window has no insets controller. */
  private fun dialogBarAppearance(): Int? {
    val shellLight = shellSchemeLight()
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val status = (window.insetsController ?: return null).systemBarsAppearance and WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
      status or (if (shellLight) WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS else 0)
    } else {
      @Suppress("DEPRECATION")
      val status = window.decorView.systemUiVisibility and View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
      @Suppress("DEPRECATION")
      status or (if (shellLight) View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR else 0)
    }
  }

  private fun mirrorBarAppearance() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    val appearance = dialogBarAppearance() ?: return
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

  // The page's `bg` runs under a transparent navigation bar (edge to edge). With 3-button
  // navigation Android draws its own contrast scrim there unless the window opts out, a band of
  // #FEFEFE under a #F6F4F1 page in light and #151518 under #100E0D in dark. React Native's edge to
  // edge turns the scrim on for the activity (`ReactActivityDelegate.onCreate`) and for every
  // Modal's dialog each time it applies the Modal's props (`ReactModalHostView.updateProperties`),
  // so the activity opts out once its delegate has run, and every dialog before each of its frames.
  // A dialog is found from the window it is presented from: a Modal's host view sits in the
  // activity's view tree or, for an overlay inside another's content, in that overlay's dialog, so
  // the walk follows each host into its dialog. A check runs before every frame of the activity
  // and of each watched dialog, and walks while this activity has a window it doesn't watch yet:
  // a dialog that just showed, or a window that is no Modal's, such as an AlertDialog, a date
  // picker or Chromium's select dialog (a popup, the text-selection toolbar or WebView autofill
  // carries its anchor's window token, not the activity's, so it is never listed). A window seen
  // once is not done: with Fabric's view preallocation (on by default) a Modal's host is created
  // with its props ahead of the commit that inserts it, and `ReactModalHostManager`'s
  // `onAfterUpdateTransaction` shows its dialog right then, so the dialog can draw for frames
  // before any walk can reach its host. So the walk goes on for a window until it is watched, or
  // until both SCRIM_WALK_MS have passed since the window was first listed and SCRIM_WALK_CHECKS
  // checks have walked for it. Neither alone is a budget. Time alone counts idle seconds: a stalled
  // JS thread or a cold low-end phone can hold a preallocated Modal's host back past it while
  // nothing draws. Checks alone run on every window's frames, so several windows drawing at
  // 120 Hz spend a count in a fraction of a second. A check only runs when the activity or a
  // watched dialog draws, so the count rises only while something renders; 60 is a second of
  // frames at 60 Hz, enough for a render that resumes after a stall to commit and insert the host.
  // A Modal's window whose host lands only after both are spent keeps its band until it closes; a
  // window that is no Modal's always spends both, and then costs nothing more. Inserting the host
  // draws the window it lands in (the parent's `addView` invalidates it, and the mount lays the new
  // view out), so the walk finds the host in the frame it is inserted. A dialog is found nested or shown over another, with no wait
  // on a focus change (a dialog shown over another takes that one's focus, never the activity's).
  // Windows are listed from API 29, the first that has the scrim. The bar's icons stay legible on
  // their own: they follow what is under the bar (`matchNavigationBarToStatusBar`,
  // `dialogBarAppearance`).
  private val scrimWatched = WeakHashMap<View, Unit>()
  private val scrimWalks = WeakHashMap<View, ScrimWalk>()

  /** An unwatched window's walk budget: when it was first listed, and the checks walked for it since. */
  private class ScrimWalk(val firstListed: Long) {
    var checks = 0
  }

  private fun clearNavigationBarScrim(target: Window) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    if (target.isNavigationBarContrastEnforced) target.isNavigationBarContrastEnforced = false
  }

  private fun clearDialogNavigationBarScrims() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    val token = window.attributes.token
    val now = SystemClock.uptimeMillis()
    var unwatched = false
    for (root in WindowInspector.getGlobalWindowViews()) {
      if (root === window.decorView || root in scrimWatched) continue
      if ((root.layoutParams as? WindowManager.LayoutParams)?.token !== token) continue
      val walk = scrimWalks.getOrPut(root) { ScrimWalk(now) }
      if (now - walk.firstListed >= SCRIM_WALK_MS && walk.checks >= SCRIM_WALK_CHECKS) continue
      walk.checks++
      unwatched = true
    }
    if (unwatched) watchDialogScrims(window.decorView)
  }

  private fun watchDialogScrims(view: View) {
    if (view is ReactModalHostView) {
      val dialogWindow = view.dialog?.window ?: return
      val decor = dialogWindow.decorView
      if (scrimWatched.put(decor, Unit) == null) {
        val dialogBars = WindowInsetsControllerCompat(dialogWindow, decor)
        clearNavigationBarScrim(dialogWindow)
        matchNavigationBarToShellScheme(dialogBars)
        decor.viewTreeObserver.addOnPreDrawListener {
          clearNavigationBarScrim(dialogWindow)
          matchNavigationBarToShellScheme(dialogBars)
          clearDialogNavigationBarScrims()
          true
        }
      }
      watchDialogScrims(decor)
      return
    }
    if (view is ViewGroup) for (i in 0 until view.childCount) watchDialogScrims(view.getChildAt(i))
  }

  // The app follows the phone's appearance. `uiMode` is a handled config change (the manifest's
  // configChanges), so the activity isn't recreated when the phone switches: React Native updates
  // `Appearance`, and the window background (the theme's `launch_background`) is re-read here. The
  // activity's bars' icons are the JS `StatusBar`'s (the navigation bar's copy the status bar's,
  // above), never the night mode's: over a running app the page keeps the app's frame when the
  // phone switches.
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
    const val SCRIM_WALK_MS = 2000L
    const val SCRIM_WALK_CHECKS = 60
    const val BAR_APPEARANCE =
        WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
            WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
    @Suppress("DEPRECATION")
    const val LIGHT_BAR_FLAGS =
        View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
  }
}
