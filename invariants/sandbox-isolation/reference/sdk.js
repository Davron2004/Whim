// ─────────────────────────────────────────────────────────────────────────────
// Whim Spike 1 — fake one-function SDK (the ONLY capability surface)
// ─────────────────────────────────────────────────────────────────────────────
// Decision #7: the bundle only ever writes against an in-house SDK. For the spike
// the SDK is a single React component, `Button`. It is the only thing `require`
// resolves (runner.js); everything else throws "module not found". That is the
// whole point of task 3.4 / the "single reachable capability surface" requirement.
//
// Note the SDK is backend-agnostic (Decision #11 hedge): the bundle says
// `<Button label=… onPress=…>`, never touches the DOM. Here that compiles to a
// real <button>, but a future native reconciler could back the same contract.
(function defineWhimSdk() {
  'use strict';
  var React = window.React;

  function Button(props) {
    return React.createElement(
      'button',
      {
        onClick: props.onPress,
        style: {
          font: '600 17px system-ui, sans-serif',
          padding: '12px 20px',
          borderRadius: '12px',          // token "md" would map here in the real SDK
          border: 'none',
          color: 'white',
          background: '#4f46e5',
          width: '100%',
          cursor: 'pointer',
        },
      },
      props.label
    );
  }

  // The injected module. `require('@whim/sdk')` returns exactly this object.
  window.__WHIM_SDK__ = { Button: Button };
})();
