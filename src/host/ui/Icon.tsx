/**
 * Icon — the shell's one way to draw an icon (system.md §3.1): a vendored Lucide path from
 * `src/design/icons`, stroked with round caps and joins on the 24 grid through react-native-svg.
 * The rendered stroke follows the size (1.5 pt below 24 pt, 1.75 pt from 24 pt) unless the caller
 * names a stroke on the grid (a tile glyph is 2). With a `label` the icon is one image element for
 * screen readers; without one it is decorative and hidden from them.
 */

import React from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { ICON_PATHS, ICON_VIEWBOX } from '../../design/icons/paths';
import type { IconName } from '../../design/icons/names';

export interface IconProps {
  name: IconName;
  /** Side in pt: 16 inline, 20 rows and buttons, 24 headers, 28 empty states. */
  size?: number;
  color: string;
  /** What a screen reader says; absent means decorative. */
  label?: string;
  /** Stroke width in 24-grid units, overriding the size's default. */
  stroke?: number;
}

/** The stroke width on the 24 grid that renders at `size` pt as system.md §3.1 asks. */
function gridStroke(size: number): number {
  const rendered = size >= 24 ? 1.75 : 1.5;
  return (rendered * ICON_VIEWBOX) / size;
}

export function Icon({ name, size = 20, color, label, stroke }: Readonly<IconProps>) {
  const a11y = label
    ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: label }
    : { accessible: false, accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const };
  return (
    <View style={{ width: size, height: size }} {...a11y}>
      <Svg width={size} height={size} viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`}>
        <Path
          d={ICON_PATHS[name]}
          fill="none"
          stroke={color}
          strokeWidth={stroke ?? gridStroke(size)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}
