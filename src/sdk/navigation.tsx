import * as React from 'react';
import type { AppSpec } from './index';

// ── Navigation (sdk-navigation D1–D4) ────────────────────────────────────────
// `nav` is deliberately a stable module-scope object rather than a hook: mini-app event
// handlers can call it directly, while the single SDK-owned NavRoot keeps React state and
// subscribes only for its mounted lifetime. Realm recreation destroys both sides together.
type NavAction =
  | { type: 'navigate'; screenName: string }
  | { type: 'back' };
type NavListener = (action: NavAction) => void;

let navListener: NavListener | undefined;

function emitNavAction(action: NavAction): void {
  navListener?.(action);
}

function subscribeToNav(listener: NavListener): () => void {
  navListener = listener;
  return () => {
    if (navListener === listener) navListener = undefined;
  };
}

export const nav = {
  navigate(screenName: string): void {
    emitNavAction({ type: 'navigate', screenName });
  },
  back(): void {
    emitNavAction({ type: 'back' });
  },
};

export interface NavRootProps {
  spec: AppSpec;
}

interface NavMessageEvent {
  data: unknown;
  source?: unknown;
}

interface NavigationWindow {
  __whimGeneration?: number;
  parent: {
    postMessage(message: string, targetOrigin: string): void;
  };
  addEventListener(type: 'message', listener: (event: NavMessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: NavMessageEvent) => void): void;
}

function navigationWindow(): NavigationWindow {
  return (globalThis as unknown as { window: NavigationWindow }).window;
}

function popNavStack(stack: string[]): string[] {
  return stack.length > 1 ? stack.slice(0, -1) : stack;
}

/** Repository-internal runtime mount point. Mini-apps use `nav`; the trusted loader mounts this root. */
export function NavRoot({ spec }: NavRootProps): React.ReactElement {
  const [stack, setStack] = React.useState<string[]>([spec.initial]);

  React.useEffect(() => {
    const unsubscribe = subscribeToNav((action) => {
      if (action.type === 'back') {
        setStack(popNavStack);
        return;
      }

      if (!Object.hasOwn(spec.screens, action.screenName)) {
        const declared = Object.keys(spec.screens).join(', ');
        console.warn(
          `vc-sdk nav: unknown screen "${action.screenName}"; declared screens: ${declared}`,
        );
        return;
      }
      setStack((current) => [...current, action.screenName]);
    });

    const onMessage = (event: NavMessageEvent): void => {
      // Host-channel-only acceptance (mirrors loader.js:212 / syscall.js's ev.source guard): only
      // the outer runtime page (window.parent) is an accepted sender for __whimNavBack.
      if (event.source !== navigationWindow().parent) return;
      if (typeof event.data !== 'string') return;

      let frame: unknown;
      try {
        frame = JSON.parse(event.data);
      } catch {
        return;
      }

      if (
        typeof frame === 'object' &&
        frame !== null &&
        !Array.isArray(frame) &&
        (frame as { __whimNavBack?: unknown }).__whimNavBack === true
      ) {
        setStack(popNavStack);
      }
    };
    navigationWindow().addEventListener('message', onMessage);

    return () => {
      unsubscribe();
      navigationWindow().removeEventListener('message', onMessage);
    };
  }, [spec]);

  React.useEffect(() => {
    const runtimeWindow = navigationWindow();
    // Opaque sandboxed srcdoc iframe: the parent's origin is unrepresentable as a
    // targetOrigin and any non-'*' value silently drops the frame; auth is receiver-side (ev.source).
    runtimeWindow.parent.postMessage( // NOSONAR
      JSON.stringify({
        __whimNavDepth: true,
        depth: stack.length - 1,
        generation: runtimeWindow.__whimGeneration,
      }),
      '*',
    );
  }, [stack.length]);

  const CurrentScreen = spec.screens[stack[stack.length - 1]];
  return React.createElement(CurrentScreen, { key: stack.length - 1 });
}
