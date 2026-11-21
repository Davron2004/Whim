/**
 * react-native-webview's `WebView`, with its props type argument named. Its 14.x typings declare
 * `class WebView<P = undefined> extends Component<WebViewProps & P>`, and `WebViewProps & undefined`
 * is `never`, so the bare class takes no props at all and every `<WebView ...>` fails to type-check.
 * `object` adds no props: these are exactly `WebViewProps`. The value is the library's own class
 * (an instantiation expression has no runtime effect).
 */
import { WebView as LibraryWebView } from 'react-native-webview';

export const WebView = LibraryWebView<object>;
export type WebView = LibraryWebView<object>;
