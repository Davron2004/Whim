// ─────────────────────────────────────────────────────────────────────────────
// NativeWhimKeyboard — codegen spec for the in-repo Android keyboard TurboModule
// (design-system-v1 F1; docs/design/system.md §6 Keyboard, "Android focuses it at once").
// ─────────────────────────────────────────────────────────────────────────────
// An Android field that asks for its keyboard must name itself: the keyboard library's
// `setFocusTo('current')` asks for the field the library last saw take focus, and a field that
// takes focus before it is attached to its window (React Native runs a view command ahead of the
// mount that attaches the view) is never seen, so that request goes to the field before it, which
// is no longer on screen. `showFor` asks for the keyboard of the field whose view is `viewTag`,
// only once the system serves that field (it neither focuses it nor asks before then).
// Android only: iOS has no implementation, and `KeyboardShell.tsx` calls it on Android alone.
// Fire-and-forget, never throws back to JS.
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  /** Shows the keyboard for the text field whose view is `viewTag`, if that field is focused and
   *  the input method serves it; otherwise does nothing. */
  showFor(viewTag: number): void;
}

// `get` (not `getEnforcing`): iOS, which has no implementation, resolves to null.
export default TurboModuleRegistry.get<Spec>('WhimKeyboard');
