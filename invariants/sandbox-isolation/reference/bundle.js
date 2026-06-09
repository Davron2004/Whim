// ─────────────────────────────────────────────────────────────────────────────
// Whim Spike 1 — hand-written mini-app bundle (stand-in for LLM output, ~20 lines)
// ─────────────────────────────────────────────────────────────────────────────
// Decision #26: hand-write bundles to prove the runtime before any LLM is involved.
// This file is SPLICED LEXICALLY into runner.js's shadowed execution scope, so the
// `require`, `React`, and the (undefined) shadowed forbidden globals are all in
// scope. It must NOT know it lives in an iframe/WebView (sandbox-rendering spec):
// it just imports the SDK, renders, and posts a string on tap.
//
// No JSX (Spike 2 owns the transpile pipeline), so UI is React.createElement.

var sdk = require('@whim/sdk');          // resolves; anything else throws (task 3.4)
var Button = sdk.Button;

function App() {
  var state = React.useState(0);
  var taps = state[0];
  var setTaps = state[1];

  return React.createElement(
    'div',
    { style: { padding: '24px', font: '16px system-ui, sans-serif', color: '#111' } },
    React.createElement('h1', { style: { fontSize: '20px' } }, 'Whim sandbox spike'),
    React.createElement('p', null, 'Taps so far: ' + taps),
    React.createElement(Button, {
      label: 'Tap me',
      onPress: function () {
        setTaps(taps + 1);
        // The one-way, string-only transport (spec §5.6). Inside the sandbox this
        // is a shim that forwards to the host; the bundle can't tell the difference.
        window.ReactNativeWebView.postMessage(
          JSON.stringify({ kind: 'tap', tapCount: taps + 1 })
        );
      },
    })
  );
}
