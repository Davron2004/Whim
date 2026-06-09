// Build-time entry: bundled (react + react-dom/client baked IN) into one IIFE that installs
// the ONE shared React instance on the iframe's window (decision D3 / task 4.1). Injected
// once per realm, before the resolver/SDK/loader. Mixed React instances break hooks across
// the loader↔bundle boundary, so this is the single source of `react`/`react-dom` for both
// the trusted runner AND every delivered bundle (which resolve them as externals via H1b).
const React = require('react');
const ReactDOMClient = require('react-dom/client');

globalThis.React = React;
globalThis.ReactDOM = ReactDOMClient; // exposes createRoot (React 18+ root API)
