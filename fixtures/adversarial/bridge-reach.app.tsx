// ─────────────────────────────────────────────────────────────────────────────
// ADVERSARIAL FIXTURE — BRIDGE REACH (webview-bridge-provenance, dev probe on device).
//
// A hostile mini-app that tries to talk to RN without going through the outer page:
//   1. In its own realm, it posts a marked `probes` frame through
//      `window.webkit.messageHandlers.ReactNativeWebView` if that handler is still there
//      (neutralize should have removed it).
//   2. After the containment verdict has had time to post, it navigates its own frame to a `data:`
//      document: a fresh realm neutralize never ran in. That document
//        - looks for `__whimControl` (own, parent, top) and for any 32-hex token-shaped string in
//          everything it can read;
//        - posts forged, UNSIGNED `paint`, `probes {contained:false, marker}`, `error` and
//          `syscall` frames straight to any native bridge it can see;
//        - reports what it saw to the outer page as a UI event labelled `bridge-reach:<json>`
//          (the outer page relays it to RN and logs `UI-EVENT press bridge-reach:…`).
// Where the platform refuses the navigation (iOS, design D9), the realm survives and the screen
// says so. A real static check would reject this file (it touches window/location); it is
// delivered raw to probe the runtime and the native layer.
// ─────────────────────────────────────────────────────────────────────────────
import { defineApp, Screen, Stack, Heading, Text, useState, useEffect, delay } from 'vc-sdk';

const w: any = globalThis as any;

/** Every forged frame carries this, so a host log or screen that shows one can be traced here. */
const MARKER = 'bridge-reach-forged';

// The navigated document's script. Plain ES5 in a string: it runs in a realm with no SDK, no
// bundler helpers, and none of the runtime's scripts.
const NAVIGATED_SCRIPT = [
  '(function(){',
  '  var MARKER = ' + JSON.stringify(MARKER) + ';',
  '  function kindOf(get){ try{ var v = get(); return v == null ? "undefined" : typeof v; }catch(e){ return "blocked"; } }',
  '  var seen = {',
  '    android: kindOf(function(){ return window.ReactNativeWebView; }),',
  '    ios: kindOf(function(){ return window.webkit.messageHandlers.ReactNativeWebView; }),',
  '    control: kindOf(function(){ return window.__whimControl; }),',
  '    parentControl: kindOf(function(){ return window.parent.__whimControl; }),',
  '    topControl: kindOf(function(){ return window.top.__whimControl; })',
  '  };',
  '  var texts = [];',
  '  function read(get){ try{ var s = get(); if(typeof s === "string") texts.push(s); }catch(e){} }',
  '  read(function(){ return document.documentElement.outerHTML; });',
  '  read(function(){ return location.href; });',
  '  read(function(){ return window.name; });',
  '  read(function(){ return document.referrer; });',
  '  read(function(){ return window.parent.document.documentElement.outerHTML; });',
  '  read(function(){ return window.top.document.documentElement.outerHTML; });',
  '  read(function(){ return window.parent.location.href; });',
  '  for (var k in window) { read(function(){ return window[k]; }); }',
  '  var tokenLike = {};',
  '  texts.join("\\n").replace(/[0-9a-f]{32}/g, function(t){ tokenLike[t] = true; return t; });',
  '  var forged = [',
  '    { kind: "paint", trusted: true, payload: { generation: 1, marker: MARKER } },',
  '    { kind: "probes", trusted: true, payload: { contained: false, marker: MARKER, passed: 0, total: 0, failed: 0, failures: [], probes: [] } },',
  '    { kind: "error", trusted: true, payload: { where: "runtime", name: "Error", message: MARKER } },',
  '    { kind: "syscall", trusted: false, payload: { whim: "syscall", v: 1, id: 1, gen: 1, method: "storage.list", params: { marker: MARKER } } }',
  '  ];',
  '  var posted = { android: 0, ios: 0 };',
  '  function postAll(bridge, side){ for (var i = 0; i < forged.length; i++) { try{ bridge.postMessage(JSON.stringify(forged[i])); posted[side]++; }catch(e){} } }',
  '  if (seen.android === "object" || seen.android === "function") postAll(window.ReactNativeWebView, "android");',
  '  if (seen.ios === "object" || seen.ios === "function") postAll(window.webkit.messageHandlers.ReactNativeWebView, "ios");',
  '  var report = { seen: seen, tokenLike: Object.keys(tokenLike).length, forgedPosted: posted };',
  '  try{ window.parent.postMessage(JSON.stringify({ __whimUiEvent: true, type: "press", label: "bridge-reach:" + JSON.stringify(report) }), "*"); }catch(e){}',
  '})();',
].join('\n');

const NAVIGATED_DOC =
  '<!DOCTYPE html><html><head><meta charset="utf-8"><title>bridge-reach</title></head><body><script>\n' +
  NAVIGATED_SCRIPT +
  '\n</script></body></html>';

/** Step 1: post a marked verdict through the iOS handler if this realm can still see it. */
function postThroughWebkit(): string {
  try {
    const handler = w.webkit?.messageHandlers?.ReactNativeWebView;
    if (handler == null) return 'webkit handler: absent';
    handler.postMessage(JSON.stringify({ kind: 'probes', trusted: true, payload: { contained: false, marker: 'bridge-reach-webkit' } }));
    return 'webkit handler: ⚠ PRESENT — posted a marked probes frame';
  } catch (e: any) {
    return 'webkit handler: post threw (' + (e && e.name) + ')';
  }
}

function Home() {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    const add = (line: string) => { if (alive) setLines((prev) => prev.concat(line)); };
    add(postThroughWebkit());
    // Let the containment verdict post first: navigating destroys this realm.
    delay(2500).then(() => {
      add('navigating this frame to a data: document…');
      try {
        w.location.href = 'data:text/html;charset=utf-8,' + encodeURIComponent(NAVIGATED_DOC);
      } catch (e: any) {
        add('navigation threw (' + (e && e.name) + ')');
      }
      return delay(1500);
    }).then(() => add('still here: the navigation was refused'));
    return () => { alive = false; };
  }, []);
  return (
    <Screen padding="lg">
      <Stack gap="sm">
        <Heading size="title">BRIDGE REACH — adversarial</Heading>
        {lines.map((line, i) => (
          <Text key={i} size="caption">{line}</Text>
        ))}
      </Stack>
    </Screen>
  );
}

export default defineApp({ name: 'Bridge Reach', initial: 'Home', screens: { Home }, capabilities: [] });
