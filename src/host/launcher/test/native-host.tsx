/** Native host adapters for React interaction tests. Screen components and hooks run unchanged;
 * layout, animation and OS APIs are represented in memory, not asserted as device behavior. */
import React from 'react';

// React Native's runtime provides the frame callbacks Node lacks; a suite that steps frames itself
// swaps these out for the test's duration.
globalThis.requestAnimationFrame ??= (callback) => setImmediate(() => callback(performance.now())) as unknown as number;
globalThis.cancelAnimationFrame ??= (id) => clearImmediate(id as unknown as NodeJS.Immediate);

type HostProps = { children?: React.ReactNode; visible?: boolean; [key: string]: unknown };
const host = (name: string) => (props: HostProps) => React.createElement(name, props, props.children);
export const View = host('View');
export const Text = host('Text');
export const TextInput = host('TextInput');
export const TouchableOpacity = host('TouchableOpacity');
export const Pressable = host('Pressable');
export const ScrollView = host('ScrollView');
export const Switch = host('Switch');
export const KeyboardAvoidingView = host('KeyboardAvoidingView');
export const InputAccessoryView = host('InputAccessoryView');
/** Counts `Keyboard.dismiss` calls, so a test can tell putting the keyboard away from submitting.
 *  The keyboard's motion is react-native-keyboard-controller's (`native-keyboard-controller.tsx`). */
export const Keyboard = {
  dismissed: 0,
  dismiss: () => { Keyboard.dismissed += 1; },
};
export const SafeAreaView = host('SafeAreaView');
export const SafeAreaProvider = host('SafeAreaProvider');
export const StatusBar = host('StatusBar');
/** Every script the host injected into a rendered WebView, oldest first. */
export const injectedScripts: string[] = [];
/** The WebView exposes `injectJavaScript` through its ref, as react-native-webview does, so a
 *  rendered MiniAppView really delivers its bundle; the scripts land in `injectedScripts`. */
export const WebView = React.forwardRef<{ injectJavaScript: (js: string) => void }, HostProps>((props, ref) => {
  React.useImperativeHandle(ref, () => ({ injectJavaScript: (js: string) => { injectedScripts.push(js); } }), []);
  return React.createElement('WebView', props, props.children as React.ReactNode);
});
export const Modal = (props: HostProps) => props.visible ? React.createElement('Modal', props, props.children) : null;
export function FlatList({ data, renderItem, ...props }: HostProps & { data: unknown[]; renderItem: (args: { item: unknown; index: number }) => React.ReactNode }) {
  return React.createElement('FlatList', props, data.map((item, index) => React.createElement(React.Fragment, { key: index }, renderItem({ item, index }))));
}
export const Platform = { OS: 'ios', Version: '26.0' as string | number, select: (options: Record<string, unknown>) => options.ios ?? options.default };
export const StyleSheet = { create: <T,>(styles: T): T => styles, hairlineWidth: 1, absoluteFill: {}, absoluteFillObject: {}, flatten: (styles: unknown) => Object.assign({}, ...([styles].flat(Infinity))) };
export const useSafeAreaInsets = () => ({ top: 20, bottom: 30, left: 0, right: 0 });
/** The phone's text size; set it before rendering to test Dynamic Type. */
export const windowMetrics = { fontScale: 1 };
export const useWindowDimensions = () => ({ width: 390, height: 844, scale: 1, fontScale: windowMetrics.fontScale });
let colorScheme: 'light' | 'dark' | null = 'light';
const schemeListeners = new Set<() => void>();
const subscribeScheme = (listener: () => void) => { schemeListeners.add(listener); return () => { schemeListeners.delete(listener); }; };
/** The phone's appearance, as `useColorScheme` reports it and re-renders on (call inside act). */
export function setColorScheme(scheme: 'light' | 'dark' | null): void {
  colorScheme = scheme;
  for (const listener of [...schemeListeners]) listener();
}
export const useColorScheme = () => React.useSyncExternalStore(subscribeScheme, () => colorScheme);
type AccessibilityEvent = 'reduceMotionChanged' | 'darkerSystemColorsChanged' | 'highTextContrastChanged' | 'screenReaderChanged';
const accessibilityListeners = new Map<AccessibilityEvent, Set<(on: boolean) => void>>();
/** The OS accessibility settings the `is…Enabled` queries answer with. Increase Contrast is one
 *  setting answered by both platform queries; `emitAccessibility` plays one platform's event. */
export const accessibilitySettings = { reduceMotion: false, increaseContrast: false, screenReader: false };
/** What the shell said to the screen reader (`announceForAccessibility`) and where it sent focus
 *  (`sendAccessibilityEvent`'s host node), oldest first; splice to reset. */
export const announcements: string[] = [];
export const accessibilityFocus: unknown[] = [];
export const AccessibilityInfo = {
  isReduceMotionEnabled: async () => accessibilitySettings.reduceMotion,
  isDarkerSystemColorsEnabled: async () => accessibilitySettings.increaseContrast,
  isHighTextContrastEnabled: async () => accessibilitySettings.increaseContrast,
  isScreenReaderEnabled: async () => accessibilitySettings.screenReader,
  announceForAccessibility: (message: string) => { announcements.push(message); },
  sendAccessibilityEvent: (node: unknown, event: string) => { if (event === 'focus') accessibilityFocus.push(node); },
  addEventListener: (event: AccessibilityEvent, listener: (on: boolean) => void) => {
    const listeners = accessibilityListeners.get(event) ?? new Set<(on: boolean) => void>();
    accessibilityListeners.set(event, listeners);
    listeners.add(listener);
    return { remove: () => { listeners.delete(listener); } };
  },
};
export function emitAccessibility(event: AccessibilityEvent, on: boolean): void {
  for (const listener of [...(accessibilityListeners.get(event) ?? [])]) listener(on);
}
export function accessibilityListenerCount(): number {
  return [...accessibilityListeners.values()].reduce((n, listeners) => n + listeners.size, 0);
}
export const Dimensions = { get: useWindowDimensions };
class Value {
  constructor(public value: number) {}
  setValue(value: number) { this.value = value; }
  interpolate() { return this.value; }
}
const animation = () => ({ start: () => {}, stop: () => {} });
type AnimationEnd = (result: { finished: boolean }) => void;
/** Timing animations run until the test says their time has passed: `finishAnimations` ends every
 *  one running, as the native driver reports it (the value at its target, `finished: true`); a
 *  stopped one ends `finished: false`. */
const runningAnimations = new Set<AnimationEnd>();
const timing = (value: Value, config: { toValue: number }) => {
  let end: AnimationEnd | undefined;
  return {
    start: (callback?: AnimationEnd) => {
      end = (result) => {
        runningAnimations.delete(end!);
        if (result.finished) value.setValue(config.toValue);
        callback?.(result);
      };
      runningAnimations.add(end);
    },
    stop: () => { if (end && runningAnimations.has(end)) end({ finished: false }); },
  };
};
export function finishAnimations(): void {
  for (const end of [...runningAnimations]) end({ finished: true });
}
export const Animated = { Value, View, Text, timing, sequence: animation, loop: animation, parallel: animation };
export const Easing = { bezier: () => {}, inOut: () => {}, ease: () => {} };
const backListeners = new Set<() => boolean>();
export const BackHandler = {
  addEventListener: (_event: string, listener: () => boolean) => {
    backListeners.add(listener);
    return { remove: () => backListeners.delete(listener) };
  },
};
export function hardwareBack(): boolean {
  return [...backListeners].reverse().some(listener => listener());
}
export function backListenerCount(): number { return backListeners.size; }
const urlListeners = new Set<(event: { url: string }) => void>();
export const Linking = {
  initialURL: null as string | null,
  opened: [] as string[],
  getInitialURL: async () => Linking.initialURL,
  openURL: async (url: string) => { Linking.opened.push(url); },
  addEventListener: (_event: string, listener: (event: { url: string }) => void) => {
    urlListeners.add(listener);
    return { remove: () => urlListeners.delete(listener) };
  },
};
export function linkListenerCount(): number { return urlListeners.size; }
export function openLink(url: string): void { for (const listener of urlListeners) listener({ url }); }
/** The system clipboard: what was last copied. */
export const Clipboard = {
  copied: [] as string[],
  setString: (text: string) => { Clipboard.copied.push(text); },
  getString: async () => Clipboard.copied.at(-1) ?? '',
};
/** Every `Share.share` call, so a test can read what the share sheet was handed. */
export const Share = {
  shared: [] as { message?: string; url?: string }[],
  share: async (content: { message?: string; url?: string }) => { Share.shared.push(content); return { action: 'sharedAction' }; },
};
export interface AlertButton { text?: string; style?: string; onPress?: () => void }
/** Every `Alert.alert` call, in order, so a test can read the dialog and press one of its buttons. */
export const Alert = {
  shown: [] as { title: string; message?: string; buttons: AlertButton[] }[],
  alert: (title: string, message?: string, buttons: AlertButton[] = []) => { Alert.shown.push({ title, message, buttons }); },
};
/** The platform locale sources `device-locale.ts` reads. Rendered suites pick the phone's locale
 *  through `LauncherRoot`'s `deviceLocale` instead; the legal-language suite swaps these per test. */
export const I18nManager = { getConstants: () => ({ isRTL: false, doLeftAndRightSwapInRTL: true, localeIdentifier: undefined }) };
export const Settings = { get: (_key: string): unknown => undefined };
/** Every call the `WhimHaptics` module received, oldest first, as `"<method>:<args joined by ,>"`.
 *  It is the only TurboModule this host registers; every other name resolves to null. */
export const hapticCalls: string[] = [];
const record = (method: string) => (...args: unknown[]) => { hapticCalls.push(`${method}:${args.join(',')}`); };
const whimHaptics = { impact: record('impact'), selection: record('selection'), notification: record('notification'), prepare: record('prepare'), cue: record('cue') };
export const TurboModuleRegistry = { get: (name: string) => (name === 'WhimHaptics' ? whimHaptics : null), getEnforcing: () => ({ play: () => {}, stop: () => {} }) };
