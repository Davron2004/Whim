/**
 * RootErrorBoundary — the one error boundary around the whole app (`App.tsx`), outside the
 * providers, the launcher shell and the dev tools (developer-observability review F3; spec
 * device-diagnostics "Uncaught host errors and fatal JS errors are captured").
 *
 * It records, then rethrows. A render error no inner boundary handles (the launcher's
 * `ScreenBoundary` wraps a screen's content only) would otherwise go React 19 `onUncaughtError`
 * → `ExceptionsManager.handleException(error, true)`, which never reaches the `ErrorUtils`
 * handler the crash capture installs, and so would kill the app with no record and no fatal slot.
 *
 * How the rethrow keeps React Native's crash behaviour: `getDerivedStateFromError` renders
 * nothing, and `componentDidCatch` records the error through `onError` and throws the SAME error.
 * React catches a throw from `componentDidCatch` in the commit phase and hands it to the nearest
 * boundary above; there is none above this one, so it goes to the root, which unmounts the tree
 * and calls `onUncaughtError` with it — exactly the fatal path the error would have taken without
 * this boundary. (React first reports the error it caught here through `onCaughtError`, which
 * React Native treats as non-fatal: one extra log line before the fatal one.) A throw deferred to
 * a later effect or timer is not this: it would leave the app rendering nothing, alive.
 *
 * No React Native import, so the launcher's Node suite renders it.
 */

import React from 'react';

interface RootErrorBoundaryProps {
  /** Records the error before it is rethrown. Must not throw. */
  onError: (error: unknown) => void;
  children?: React.ReactNode;
}

interface RootErrorBoundaryState {
  failed: boolean;
}

export default class RootErrorBoundary extends React.Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): RootErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    this.props.onError(error);
    throw error;
  }

  render(): React.ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
