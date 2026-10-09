package com.whim.keyboard

import android.app.Activity
import android.graphics.Rect
import android.os.Build
import android.view.ViewTreeObserver
import android.view.WindowInsets
import android.view.WindowManager
import androidx.annotation.RequiresApi
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.PixelUtil

/**
 * Reports a keyboard that changes height while it is up (another keyboard, the emoji or voice
 * panel) as one more `keyboardDidShow`, on Android 11 and later.
 *
 * React Native's root view reports the keyboard from the window's insets on 11+, but only when it
 * shows or hides; on 10 and older it compares heights, so it also reports one that grows or
 * shrinks. Whim draws edge to edge (`edgeToEdgeEnabled`), so no window resizes for the keyboard:
 * every frame pads itself by the keyboard's top edge from the last event (`keyboard-shell.ts`),
 * and without an event for a new height that padding would stay where the old keyboard ended.
 *
 * This fills only that gap. It reads the same window, with the same arithmetic, and sends the
 * same payload React Native sends for a show, so a frame can't tell the two apart; it leaves the
 * show and hide themselves to React Native, so nothing is reported twice.
 */
class KeyboardFrameReporter(
  private val activity: Activity,
  private val reactContext: () -> ReactContext?,
) : ViewTreeObserver.OnGlobalLayoutListener {

  private val visibleArea = Rect()

  /** The keyboard's frame (top edge, left edge, width, height in px) last seen while it was up,
   *  or null while it is down. */
  private var shown: List<Int>? = null

  fun attach() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
    activity.window.decorView.viewTreeObserver.addOnGlobalLayoutListener(this)
  }

  fun detach() {
    activity.window.decorView.viewTreeObserver.removeOnGlobalLayoutListener(this)
  }

  override fun onGlobalLayout() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) check()
  }

  @RequiresApi(Build.VERSION_CODES.R)
  private fun check() {
    val root = activity.window.decorView
    val insets = root.rootWindowInsets ?: return
    if (!insets.isVisible(WindowInsets.Type.ime())) {
      shown = null
      return
    }
    // ReactRootView.checkForKeyboardEvents, verbatim: the keyboard's height above the bars, and
    // its top edge at the bottom of what the window still shows.
    root.getWindowVisibleDisplayFrame(visibleArea)
    val height = insets.getInsets(WindowInsets.Type.ime()).bottom - insets.getInsets(WindowInsets.Type.systemBars()).bottom
    val softInputMode = (root.layoutParams as? WindowManager.LayoutParams)?.softInputMode
    val screenY = if (softInputMode == WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING) visibleArea.bottom - height else visibleArea.bottom
    val frame = listOf(screenY, visibleArea.left, visibleArea.width(), height)
    val previous = shown
    shown = frame
    // The first frame while up is the show, which React Native reports itself.
    if (previous == null || previous == frame) return
    val context = reactContext() ?: return
    val end = Arguments.createMap()
    end.putDouble("height", PixelUtil.toDIPFromPixel(height.toFloat()).toDouble())
    end.putDouble("screenX", PixelUtil.toDIPFromPixel(visibleArea.left.toFloat()).toDouble())
    end.putDouble("width", PixelUtil.toDIPFromPixel(visibleArea.width().toFloat()).toDouble())
    end.putDouble("screenY", PixelUtil.toDIPFromPixel(screenY.toFloat()).toDouble())
    val event = Arguments.createMap()
    event.putMap("endCoordinates", end)
    event.putString("easing", "keyboard")
    event.putDouble("duration", 0.0)
    context.emitDeviceEvent("keyboardDidShow", event)
  }
}
