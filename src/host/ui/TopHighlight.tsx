/**
 * TopHighlight — a raised surface's 1 px top highlight (dark only, `TOP_HIGHLIGHT`) as its own line
 * over the surface, never a border on it: on Android React Native shrinks a rounded view's
 * background by 0.8 px on every side once it has any border, which left a line of the canvas
 * between the surface and its shadow along the sides and bottom (#218). The surface keeps 1 px of top
 * padding for the line. Render it as the surface's first child; it takes no touch and screen readers
 * pass over it. A surface rounded at the top only (the sheet, whose bottom is the screen's) takes
 * `corners="top"`: the line's box is then its rounded top alone.
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
    left: 0,
    borderTopWidth: 1,
    borderColor: t.topHighlight,
  },
}));

interface TopHighlightProps {
  radius: number;
  continuous?: boolean;
  /** `all` (default): over the whole surface, every corner `radius`. `top`: over its rounded top. */
  corners?: 'all' | 'top';
}

export function TopHighlight({ radius, continuous = false, corners = 'all' }: Readonly<TopHighlightProps>) {
  const s = styles(useTokens());
  const shape =
    corners === 'top'
      ? { height: radius, borderTopLeftRadius: radius, borderTopRightRadius: radius }
      : { bottom: 0, borderRadius: radius };
  return <View pointerEvents="none" style={[s.line, shape, continuous ? { borderCurve: 'continuous' as const } : null]} />;
}
