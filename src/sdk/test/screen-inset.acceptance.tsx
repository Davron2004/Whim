// Node acceptance suite for the host chrome inset in `Screen` (beta-1 D5, sandbox-rendering
// "Screen content clears the host's bottom chrome"). Auto-discovered by `src/sdk/test/run.mjs`.
// The inset reaches the SDK the way the trusted loader delivers it, as a prop of `NavRoot`; the
// app's screens are ordinary components that render the public `Screen`.
import assert from 'node:assert';
import * as React from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import * as publicSdk from '../index';
import { Screen, Text, type AppSpec } from '../index';
import { NavRoot } from '../navigation';
import { chromeInsetContext } from '../chrome-inset';
import { DEFAULT_THEME, sanitizeTheme } from '../theme';
import { space, type SpaceToken } from '../tokens';

/** Compile-time only: the @ts-expect-error below fails the typecheck if the public theme type
 *  ever grows the inset. */
export function publicThemeHasNoChromeInset(theme: import('vc-sdk').WhimTheme): unknown {
  // @ts-expect-error the chrome inset is SDK-internal and never part of the public theme type.
  return theme.chromeInsetBottom;
}

// NavRoot reports its depth to the parent page and listens for its back requests.
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    __whimGeneration: 1,
    parent: { postMessage(): void {} },
    addEventListener(): void {},
    removeEventListener(): void {},
  },
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function specOf(screen: () => React.ReactElement): AppSpec {
  return { name: 'Inset acceptance', initial: 'Home', screens: { Home: screen }, capabilities: [] };
}

function screenWith(padding?: SpaceToken): () => React.ReactElement {
  return () => React.createElement(Screen, { padding }, React.createElement(Text, null, 'last row'));
}

function isScreen(node: ReactTestInstance): boolean {
  return node.type === 'div' && (node.props.style as { minHeight?: string } | undefined)?.minHeight === '100%';
}

/** The padding of every rendered Screen (the element carrying its `minHeight: 100%`), outermost
 *  first. */
async function screenPaddings(element: React.ReactElement): Promise<string[]> {
  let renderer: ReturnType<typeof create> | undefined;
  await act(async () => {
    renderer = create(element);
  });
  const paddings = renderer!.root.findAll(isScreen).map((node) => (node.props.style as { padding: string }).padding);
  await act(async () => renderer!.unmount());
  assert.ok(paddings.length > 0, 'a Screen rendered');
  return paddings;
}

/** The padding shorthand as [top, right, bottom], or one value when every side is the same. */
function sides(padding: string): string[] {
  return padding.match(/calc\([^)]*\)|\S+/g) ?? [];
}

// ── With an inset, the bottom padding is the token plus the inset ─────────────
{
  const [padding] = await screenPaddings(
    React.createElement(NavRoot, { spec: specOf(screenWith()), chromeInsetBottom: 84 }),
  );
  const [top, right, bottom] = sides(padding);
  assert.deepStrictEqual(top, space('lg'), 'the top padding stays the default lg token');
  assert.deepStrictEqual(right, space('lg'), 'so do the sides');
  assert.deepStrictEqual(bottom, `calc(${space('lg')} + 84px)`, 'the bottom padding is the lg token plus the 84px the orb covers');
}

// The `none` token is a bare `0`: every term of the bottom calc() still carries a unit, or the
// browser would drop the whole padding declaration.
{
  const [padding] = await screenPaddings(
    React.createElement(NavRoot, { spec: specOf(screenWith('none')), chromeInsetBottom: 76 }),
  );
  const [top, , bottom] = sides(padding);
  assert.deepStrictEqual(top, space('none'));
  assert.ok(/^calc\(0px \+ 76px\)$/.test(bottom), `padding="none" pads the bottom by the inset alone, with units (got ${bottom})`);
}

// ── Without an inset, Screen pads exactly as before ───────────────────────────
for (const [label, element] of [
  ['no inset supplied', React.createElement(NavRoot, { spec: specOf(screenWith()) })],
  ['an inset of 0', React.createElement(NavRoot, { spec: specOf(screenWith()), chromeInsetBottom: 0 })],
  ['a Screen outside the runtime root', React.createElement(screenWith())],
] as const) {
  const [padding] = await screenPaddings(element);
  assert.deepStrictEqual(padding, space('lg'), `${label}: the padding is exactly the lg token`);
}

// ── Only the outermost Screen, the scrollable content, takes the inset ────────
{
  const nested = () => React.createElement(Screen, null, React.createElement(Screen, { padding: 'md' }, 'inner'));
  const [outer, inner] = await screenPaddings(React.createElement(NavRoot, { spec: specOf(nested), chromeInsetBottom: 84 }));
  assert.deepStrictEqual(sides(outer)[2], `calc(${space('lg')} + 84px)`, 'the outer Screen clears the orb');
  assert.deepStrictEqual(inner, space('md'), 'a Screen nested inside it pads exactly its own token');
}

// ── Generated code can't read the inset ───────────────────────────────────────
{
  const exported = Object.entries(publicSdk);
  assert.ok(
    !exported.some(([, value]) => value === chromeInsetContext || value === chromeInsetContext()),
    'no public vc-sdk export is the inset context',
  );
  assert.deepStrictEqual(
    exported.map(([name]) => name).filter((name) => /inset|chrome/i.test(name)),
    [],
    'no public vc-sdk export is named for the inset',
  );
  const theme = sanitizeTheme({ ...DEFAULT_THEME, chromeInsetBottom: 84 });
  assert.ok(!('chromeInsetBottom' in theme), 'the theme the SDK resolves its tokens from drops an inset planted in the theme global');
}

console.log('SDK screen inset acceptance: PASS');
