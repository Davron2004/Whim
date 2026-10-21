/**
 * TopHighlight — a raised surface's 1 px top highlight (dark only, `TOP_HIGHLIGHT`) as its own line
 * over the surface, never a border on it: on Android React Native shrinks a rounded view's
 * background by 0.8 px on every side once it has any border, which left a line of the canvas
 * between the surface and its shadow along the sides and bottom (#218; the Sheet draws its own the
 * same way). The surface keeps 1 px of top padding for the line. Render it as the surface's first
 * child; it takes no touch and screen readers pass over it.
 */
import React from 'react';
import { View } from 'react-native';
import { useTokens } from './tokens';
import { makeStyles } from './tokens-pure';

const styles = makeStyles((t) => ({
  line: {
    position: 'absolute' as const,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderTopWidth: 1,
    borderColor: t.topHighlight,
  },
}));

export function TopHighlight({ radius, continuous = false }: Readonly<{ radius: number; continuous?: boolean }>) {
  const s = styles(useTokens());
  return <View pointerEvents="none" style={[s.line, { borderRadius: radius }, continuous ? { borderCurve: 'continuous' as const } : null]} />;
}
