// Node acceptance suite for `Icon` and the `icon` props of `Button`, `ListItem` and `EmptyState`
// (sdk-design-system "The SDK adds components and deprecates without removing", "One vendored icon
// set draws every icon": an inline SVG with the vendored path, no network request). Auto-discovered
// by `src/sdk/test/run.mjs`; no theme global is installed, so the default theme renders.
import assert from 'node:assert';
import * as React from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import * as publicSdk from '../index';
import { Button, EmptyState, Icon, List, ListItem } from '../index';
import { DEFAULT_THEME } from '../theme';
import { resolveTextColor } from '../tokens';
import { ICON_PATHS, ICON_VIEWBOX } from '../../design/icons/paths';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(element: React.ReactElement): Promise<ReactTestInstance> {
  let renderer: ReturnType<typeof create> | undefined;
  await act(async () => {
    renderer = create(element);
  });
  return renderer!.root;
}

function svgs(root: ReactTestInstance): ReactTestInstance[] {
  return root.findAll((node) => node.type === 'svg');
}

function drawnPath(svg: ReactTestInstance): string {
  return svg.find((node) => node.type === 'path').props.d as string;
}

/** The stroke on screen, in CSS px: the viewBox stroke scaled by the rendered side. */
function renderedStroke(svg: ReactTestInstance): number {
  return ((svg.props.strokeWidth as number) * (svg.props.width as number)) / ICON_VIEWBOX;
}

// ── The public surface gains the icon, nothing internal ───────────────────────
assert.ok(typeof publicSdk.Icon === 'function', 'vc-sdk exports Icon');
assert.ok(!('Glyph' in publicSdk), 'the internal glyph renderer is not public');

// ── A set name draws its vendored path ────────────────────────────────────────
{
  const [svg] = svgs(await render(<Icon name="timer" />));
  assert.deepStrictEqual(drawnPath(svg), ICON_PATHS.timer, 'timer draws the vendored timer path');
  assert.deepStrictEqual([svg.props.width, svg.props.height], [20, 20], 'the default size is md, 20 px');
  assert.deepStrictEqual(svg.props['aria-hidden'], true, 'an icon with no label is decorative');
  assert.ok(svg.props.role === undefined, 'a decorative icon has no img role');
}

// ── Names never fail: alias, fallback, non-string ─────────────────────────────
{
  const [alias] = svgs(await render(<Icon name="home" />));
  assert.deepStrictEqual(drawnPath(alias), ICON_PATHS.house, 'the legacy name home draws house');
  const [unknown] = svgs(await render(<Icon name="no-such-icon-anywhere" />));
  assert.deepStrictEqual(drawnPath(unknown), ICON_PATHS.circle, 'an unknown name draws the circle, never a blank');
  const [missing] = svgs(await render(<Icon name={undefined as unknown as string} />));
  assert.deepStrictEqual(drawnPath(missing), ICON_PATHS.circle, 'a missing name from an untyped bundle draws the circle');
}

// ── Sizes keep system.md §3.1's rendered stroke ───────────────────────────────
for (const [size, px, stroke] of [
  ['sm', 16, 1.5],
  ['md', 20, 1.5],
  ['lg', 24, 1.75],
] as const) {
  const [svg] = svgs(await render(<Icon name="coffee" size={size} />));
  assert.deepStrictEqual(svg.props.width, px, `size ${size} renders ${px} px`);
  assert.ok(Math.abs(renderedStroke(svg) - stroke) < 1e-9, `size ${size} strokes ${stroke} px on screen (got ${renderedStroke(svg)})`);
}

// ── Colour is a text colour token; a label makes it an image ──────────────────
{
  const [svg] = svgs(await render(<Icon name="heart" color="danger" label="Favourite" />));
  assert.deepStrictEqual(svg.props.style.color, resolveTextColor(DEFAULT_THEME, 'danger'), 'danger resolves to its readable text form');
  assert.deepStrictEqual(svg.props.stroke, 'currentColor', 'the path strokes in that colour');
  assert.deepStrictEqual([svg.props.role, svg.props['aria-label']], ['img', 'Favourite'], 'a labelled icon is announced by its label');
}

// ── Inline vector only: nothing that could fetch ──────────────────────────────
{
  const root = await render(<Icon name="camera" size="lg" />);
  const fetching = root.findAll((node) => typeof node.type === 'string' && ('href' in node.props || 'xlinkHref' in node.props || 'src' in node.props));
  assert.deepStrictEqual(fetching.length, 0, 'no element of an icon references a resource');
  assert.deepStrictEqual(
    root.findAll((node) => typeof node.type === 'string').map((node) => node.type),
    ['svg', 'path'],
    'an icon is one inline svg with one path',
  );
}

// ── Button, ListItem and EmptyState take an icon ──────────────────────────────
{
  let pressed = 0;
  const root = await render(<Button label="Add item" icon="plus" variant="secondary" onPress={() => (pressed += 1)} />);
  const button = root.find((node) => node.type === 'button');
  const [svg] = svgs(button);
  assert.deepStrictEqual(drawnPath(svg), ICON_PATHS.plus, 'the button draws its icon');
  assert.ok(svg.props.style.color === undefined, 'the button icon takes the label colour (currentColor)');
  assert.deepStrictEqual(button.children[button.children.length - 1], 'Add item', 'the label follows the icon');
  await act(async () => button.props.onClick());
  assert.deepStrictEqual(pressed, 1, 'a button with an icon still presses');
}
{
  const root = await render(<Button label="Save" />);
  assert.deepStrictEqual(svgs(root).length, 0, 'a button without an icon draws none');
}
{
  const root = await render(
    <List>
      <ListItem title="Coffee" icon="coffee" />
      <ListItem title="Plain" />
    </List>,
  );
  const drawn = svgs(root);
  assert.deepStrictEqual(drawn.map(drawnPath), [ICON_PATHS.coffee], 'only the row with an icon draws one');
  assert.deepStrictEqual(drawn[0].props.width, 20, 'a row icon is 20 px');
}
{
  const root = await render(<EmptyState icon="inbox" title="Nothing yet" hint="Add one" />);
  const [svg] = svgs(root);
  assert.deepStrictEqual([drawnPath(svg), svg.props.width], [ICON_PATHS.inbox, 32], 'the empty state draws a 32 px icon');
  const plain = await render(<EmptyState title="Nothing yet" />);
  assert.deepStrictEqual(svgs(plain).length, 0, 'an empty state without an icon draws none');
}

console.log('SDK icon acceptance: PASS');
