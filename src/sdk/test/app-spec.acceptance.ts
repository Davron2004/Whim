// Node acceptance suite for `defineApp`'s tile declaration (sdk-design-system "An app names its tint
// and glyph, and every name resolves"; "The SDK adds components and deprecates without removing":
// `tileColor` keeps working). The SDK only types the declaration; the launcher's `declaredTile` is
// its real consumer, so each declaration typed here goes through it. Auto-discovered by
// `src/sdk/test/run.mjs`.
import assert from 'node:assert';
import { defineApp, type AppSpec } from '../index';
import { declaredTile } from '../../host/launcher/tile-identity';

const base = { name: 'Pour Timer', initial: 'Home', screens: {}, capabilities: [] } satisfies AppSpec;

/** Compile-time only: the declarations an app may write, and the one it may not. */
export function tileDeclarationTypes(): AppSpec[] {
  return [
    defineApp({ ...base, tint: 'purple', icon: 'coffee' }),
    defineApp({ ...base, tint: ['ocean', 'blue', 'indigo'] }),
    defineApp({ ...base, tint: 'chartreuse', icon: 'not-a-glyph' }), // unknown names still type-check
    defineApp({ ...base, tileColor: '#2563eb' }), // deprecated, still accepted
    // @ts-expect-error at most three ranked tints
    defineApp({ ...base, tint: ['slate', 'stone', 'ocean', 'blue'] }),
    // @ts-expect-error a tint is a name, not a number
    defineApp({ ...base, tint: 3 }),
  ];
}

// ── A ranked declaration reaches the launcher as declared ─────────────────────
assert.deepStrictEqual(
  declaredTile(defineApp({ ...base, tint: ['purple', 'blue', 'rose'], icon: 'coffee' }), 'app-1', base.name),
  { ranked: ['purple', 'blue', 'rose'], icon: 'coffee' },
  'three ranked tints and a glyph pass through defineApp to the launcher unchanged',
);

// ── One name, an alias, an unknown name: none fails ───────────────────────────
assert.deepStrictEqual(declaredTile(defineApp({ ...base, tint: 'orchid', icon: 'palette' }), 'app-1', base.name).ranked, ['orchid']);
{
  const first = declaredTile(defineApp({ ...base, tint: 'chartreuse', icon: 'home' }), 'app-2', base.name);
  const again = declaredTile(defineApp({ ...base, tint: 'chartreuse', icon: 'home' }), 'app-2', base.name);
  assert.deepStrictEqual(first, again, 'an unknown tint resolves the same way every time for one app');
  assert.deepStrictEqual(first.icon, 'house', 'a legacy glyph name resolves through the alias map');
}

// ── The deprecated tileColor still decides the tint when no tint is declared ──
assert.deepStrictEqual(
  declaredTile(defineApp({ ...base, tileColor: '#a21caf' }), 'app-3', base.name).ranked,
  ['orchid'],
  'a tileColor-only app keeps the tint nearest its colour',
);

console.log('SDK app spec acceptance: PASS');
