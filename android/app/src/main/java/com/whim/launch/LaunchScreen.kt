package com.whim.launch

import android.app.Activity
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewTreeObserver

/**
 * Holds the launch screen on a cold start until the launcher draws Home (design-system-v1 D12;
 * docs/design/system.md §4.4 M27), with no new dependency: the window's first draw is withheld
 * (a pre-draw listener, the platform's documented way to keep a splash up), so Android 12+ keeps
 * its system splash and older versions keep the launch window (`Theme.Whim.Launch`). [release]
 * ends the hold; on 12+ the splash then fades out over [FADE_MS]. If JS never calls it (a launch
 * that fails before Home), [CAP_MS] ends it anyway. Main thread only.
 */
object LaunchScreen {
  const val CAP_MS = 3000L
  const val FADE_MS = 160L

  private var held = false
  private var released = false

  /** Called from `MainActivity.onCreate`. Only the process's first activity holds: a warm start
   *  draws at once. */
  fun hold(activity: Activity) {
    if (held) return
    held = true
    val content = activity.findViewById<View>(android.R.id.content)
    content.viewTreeObserver.addOnPreDrawListener(
      object : ViewTreeObserver.OnPreDrawListener {
        override fun onPreDraw(): Boolean {
          if (!released) return false
          content.viewTreeObserver.removeOnPreDrawListener(this)
          return true
        }
      },
    )
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      activity.splashScreen.setOnExitAnimationListener { splash ->
        splash.animate().alpha(0f).setDuration(FADE_MS).withEndAction { splash.remove() }.start()
      }
    }
    Handler(Looper.getMainLooper()).postDelayed({ release() }, CAP_MS)
  }

  /** Lets the window draw; the withheld frame is retried every vsync, so the next one shows Home. */
  fun release() {
    released = true
  }
}
