// esbuild `inject` shim for the app-bundle build: provides the `React` binding the classic
// JSX transform (`React.createElement`) needs, resolved from the EXTERNAL `react` (→ the host-
// injected `window.React` at runtime via H1b). The fixture imports only from `vc-sdk` and
// never names React itself; this makes its compiled `React.createElement(...)` calls resolve
// to the one shared instance without bundling a second copy of React into the app.
import * as React from 'react';
export { React };
