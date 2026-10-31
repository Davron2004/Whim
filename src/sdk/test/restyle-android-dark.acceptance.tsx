// Node acceptance suite for the restyled SDK controls on Android in the dark scheme, inside a `Modal`
// (docs/design/system.md §7.2; design-system-v1 task 6.7). The theme is read once per realm, so this
// case has a suite of its own beside `restyle-android.acceptance.tsx` (light) and
// `restyle-ios.acceptance.tsx` (dark iOS). Auto-discovered by `src/sdk/test/run.mjs`.
import assert from 'node:assert';
import * as React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Card, Modal, Slider, Switch } from '../index';
import { COLORS } from '../../design/tokens';
import { contrastRatio } from '../../design/tints';

const THEME = { scheme: 'dark', tint: 'purple', platform: 'android', fontScale: 1, increaseContrast: false, reduceMotion: false };
(globalThis as { __WHIM_THEME__?: unknown }).__WHIM_THEME__ = THEME;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const dark = COLORS.dark;

function mount(element: React.ReactElement): ReactTestRenderer {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(element);
  });
  return renderer!;
}

function styleOf(node: ReactTestInstance): Record<string, unknown> {
  return (node.props.style ?? {}) as Record<string, unknown>;
}

try {
  // ── In a dark Modal the Material off track's outline and the empty slider track hold 3:1 ──
  const inModal = mount(
    <Modal visible onClose={() => {}}>
      <Card>
        <Switch label="Remind me" value={false} onChange={() => {}} />
        <Slider value={0} onChange={() => {}} />
      </Card>
    </Modal>,
  ).root;
  const outlines = inModal.findAll((n) => n.type === 'span' && styleOf(n).width === '52px');
  assert.deepStrictEqual(outlines.length, 1, 'Android draws the Material 52-wide track');
  const edges = {
    "off switch track's outline": String(styleOf(outlines[0]).border).replace('2px solid ', ''),
    'empty slider track': String(styleOf(inModal.find((n) => n.type === 'div' && styleOf(n).height === '6px')).background),
  };
  for (const [what, edge] of Object.entries(edges)) {
    for (const surface of ['sheet', 'sheet-group'] as const) {
      const ratio = contrastRatio(edge, dark[surface]);
      assert.ok(ratio >= 3, `in a dark Modal the ${what} holds 3:1 on ${surface} (${ratio.toFixed(2)}:1)`);
    }
  }
} finally {
  delete (globalThis as { __WHIM_THEME__?: unknown }).__WHIM_THEME__;
}

console.log('SDK restyle (Android, dark) acceptance: PASS');
