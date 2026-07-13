# SDK navigation API contract

## Mini-app surface

`src/sdk/index.tsx` exports one stable module-scope object:

```ts
export const nav: {
  navigate(screenName: string): void;
  back(): void;
};
```

It has exactly those two methods. `navigate` and `back` synchronously emit an action to the
currently mounted SDK navigation root. They are ordinary functions, not hooks, and are safe to
call from event handlers. Calls made while no navigation root is mounted are no-ops.

## Loader mount surface

The internal runtime export is:

```ts
export interface NavRootProps {
  spec: AppSpec;
}

export function NavRoot({ spec }: NavRootProps): React.ReactElement;
```

The trusted loader mounts `NavRoot` once per generation with the bundle's default `AppSpec`.
`NavRoot` owns a `string[]` stack initialized to `[spec.initial]` and renders the component at
`spec.screens[stack[stack.length - 1]]`. Duplicate pushes are retained. Back pops exactly one
entry when depth is at least one and returns the same stack at depth zero.

## Emitter subscription

There is one module-scope listener slot, matching the one-root-per-generation invariant.
`NavRoot` subscribes in its mount effect and conditionally clears only its own listener during
effect cleanup. Iframe recreation destroys the object, listener, and state structurally.

An unknown `navigate` target is not pushed. `NavRoot` emits one `console.warn` naming the target
and the comma-separated keys of `spec.screens`; it does not throw or render a fallback.

## Frames

After initial mount and after every stack-length change, `NavRoot` calls
`parent.postMessage(JSON.stringify(frame), '*')` with this exact decoded payload:

```ts
{
  __whimNavDepth: true,
  depth: stack.length - 1,
  generation: window.__whimGeneration,
}
```

The hint is unauthenticated and grants no authority.

While mounted, `NavRoot` listens to the realm's `message` event. The production host sends back
navigation as a serialized wire frame, so `NavRoot` accepts only string `event.data`, parses it
with fail-closed JSON handling, and pops exactly one entry when the decoded value has this shape:

```ts
{ __whimNavBack: true }
```

Extra properties are tolerated. Malformed JSON, decoded primitives or arrays, direct object
`event.data`, and decoded objects without the literal `true` marker are ignored. The listener
adds no authority. At depth zero the frame is a silent no-op. Cleanup removes the message
listener.
