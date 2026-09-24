/** Native host adapters for React interaction tests. Screen components and hooks run unchanged;
 * layout, animation and OS APIs are represented in memory, not asserted as device behavior. */
import React from 'react';

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
export const SafeAreaView = host('SafeAreaView');
export const StatusBar = host('StatusBar');
/** Every script the host injected into a rendered WebView, oldest first. */
export const injectedScripts: string[] = [];
/** The WebView exposes `injectJavaScript` through its ref, as react-native-webview does, so a
 *  rendered MiniAppView really delivers its bundle; the scripts land in `injectedScripts`. */
export const WebView = React.forwardRef<{ injectJavaScript: (js: string) => void }, HostProps>((props, ref) => {
  React.useImperativeHandle(ref, () => ({ injectJavaScript: (js: string) => { injectedScripts.push(js); } }), []);
  return React.createElement('WebView', props, props.children);
});
export const Modal = (props: HostProps) => props.visible ? React.createElement('Modal', props, props.children) : null;
export function FlatList({ data, renderItem, ...props }: HostProps & { data: unknown[]; renderItem: (args: { item: unknown; index: number }) => React.ReactNode }) {
  return React.createElement('FlatList', props, data.map((item, index) => React.createElement(React.Fragment, { key: index }, renderItem({ item, index }))));
}
export const Platform = { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default };
export const StyleSheet = { create: <T,>(styles: T): T => styles, hairlineWidth: 1, absoluteFillObject: {}, flatten: (styles: unknown) => Object.assign({}, ...([styles].flat(Infinity))) };
export const useSafeAreaInsets = () => ({ top: 20, bottom: 30, left: 0, right: 0 });
export const useWindowDimensions = () => ({ width: 390, height: 844, scale: 1, fontScale: 1 });
export const Dimensions = { get: useWindowDimensions };
class Value {
  constructor(public value: number) {}
  setValue(value: number) { this.value = value; }
  interpolate() { return this.value; }
}
const animation = () => ({ start: () => {}, stop: () => {} });
export const Animated = { Value, View, Text, timing: animation, sequence: animation, loop: animation, parallel: animation };
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
export interface AlertButton { text?: string; style?: string; onPress?: () => void }
/** Every `Alert.alert` call, in order, so a test can read the dialog and press one of its buttons. */
export const Alert = {
  shown: [] as { title: string; message?: string; buttons: AlertButton[] }[],
  alert: (title: string, message?: string, buttons: AlertButton[] = []) => { Alert.shown.push({ title, message, buttons }); },
};
export const Vibration = { vibrate: () => {}, cancel: () => {} };
/** The platform locale sources `device-locale.ts` reads. Rendered suites pick the phone's locale
 *  through `LauncherRoot`'s `deviceLocale` instead; the legal-language suite swaps these per test. */
export const I18nManager = { getConstants: () => ({ isRTL: false, doLeftAndRightSwapInRTL: true, localeIdentifier: undefined }) };
export const Settings = { get: (_key: string): unknown => undefined };
export const TurboModuleRegistry = { get: () => null, getEnforcing: () => ({ play: () => {}, stop: () => {} }) };
