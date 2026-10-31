package com.whim.keyboard

import android.content.Context
import android.util.Log
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.UIManagerHelper
import com.whim.tone.NativeWhimKeyboardSpec

/**
 * WhimKeyboard — the in-repo Android keyboard TurboModule (design-system-v1 F1; system.md §6).
 * `showFor` asks the input method to show the keyboard for the one field named by its view tag,
 * on the UI thread, once that field is focused and served (`InputMethodManager.isActive(view)`,
 * which first lets the manager catch up with a focus change it has not processed yet). It never
 * takes focus. The keyboard library's `setFocusTo("current")` cannot stand in for it: it asks for
 * the field the library last saw take focus, and a field focused before it was attached to its
 * window is never seen (measured on API 37: every request went to the previous page's field, no
 * longer on screen, "not served", while the edited row's field was the served one). The spec class
 * is generated into `com.whim.tone`, the codegen `javaPackageName` of every in-app spec.
 */
@ReactModule(name = WhimKeyboardModule.NAME)
class WhimKeyboardModule(reactContext: ReactApplicationContext) : NativeWhimKeyboardSpec(reactContext) {

  override fun getName(): String = NAME

  override fun showFor(viewTag: Double) {
    val tag = viewTag.toInt()
    UiThreadUtil.runOnUiThread {
      val field = try {
        UIManagerHelper.getUIManagerForReactTag(reactApplicationContext, tag)?.resolveView(tag) as? EditText
      } catch (_: RuntimeException) {
        // The view is gone (the field unmounted before this ran): nothing to show a keyboard for.
        null
      } ?: return@runOnUiThread
      if (!field.isFocused) return@runOnUiThread
      val imm = field.context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager ?: return@runOnUiThread
      if (imm.isActive(field)) {
        unservedLogged.remove(tag)
        imm.showSoftInput(field, 0)
      } else if (unservedLogged.add(tag)) {
        // A focused field the manager does not serve is otherwise a silent no-op; one line per field until it is served.
        Log.d(NAME, "showFor: view tag $tag is focused but not served by the input method")
      }
    }
  }

  private val unservedLogged = HashSet<Int>()

  companion object {
    const val NAME = "WhimKeyboard"
  }
}
