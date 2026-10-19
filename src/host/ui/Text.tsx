/**
 * Text — shell text on the type scale (system.md §2.7): one system family, size / line / weight /
 * tracking from the token, a colour role from `useTokens()`, Dynamic Type up to 200%. Titles are
 * headers to screen readers; counting and ticking numbers take `tabular`.
 */

import React from 'react';
import { Text as RNText, type AccessibilityRole, type StyleProp, type TextStyle } from 'react-native';
import type { ColorRole, TypeToken } from '../../design/tokens';
import { useTokens } from './tokens';
import { MAX_FONT_SCALE, TABULAR, typeStyle, type TypeStyle } from './tokens-pure';

/** How far under the token's line height text that may wrap is set, in pt per line. */
const LINE_ROOM = 0.0006;

/**
 * A type-scale size for text that may wrap: its lines a hair under the token's line height, so the
 * box the text is given holds its last line. Where the lines land on whole pixels the box is exactly
 * as tall as they are, and Yoga computes that height as the difference of two 32-bit floats
 * (`PixelGrid.cpp`): across a power of two from the top of the window, at a position that is not a
 * whole point (under a hairline separator), it comes out short by about 0.0001 pt (95.999878 for two
 * 48 pt lines, measured on iOS). iOS then lays the text out in a box its last line does not fit: that
 * line is dropped and the one before it runs on unwrapped and is cut at the edge.
 *
 * The room can itself bring a height to just under a whole pixel, where the same arithmetic loses it
 * again, so no amount is right everywhere; this one is chosen against that model
 * (`shell-surfaces-ui`): two to twelve lines of every size, at every iOS text size, on screens of two
 * and three pixels a point, anywhere from 256 to 16384 pt down the window, keep their last line, and
 * a single line keeps exactly the token's height in pixels. 0.001 loses a line of `title1` at 178.6%;
 * 0.002 and more shorten a single line by a pixel.
 */
export function wrappingType(token: TypeToken, header = false): TypeStyle {
  const type = typeStyle(token, header);
  return { ...type, lineHeight: type.lineHeight - LINE_ROOM };
}

/** The sizes a screen reader treats as headings by default. */
const HEADER_TYPES: ReadonlySet<TypeToken> = new Set(['largeTitle', 'title1', 'title2']);

export interface TextProps {
  children: React.ReactNode;
  /** The type-scale size; default `body`. */
  type?: TypeToken;
  /** A colour role; default `text`. */
  color?: ColorRole;
  /** The size's header weight (footnote 600 for section headers). */
  header?: boolean;
  /** Tabular figures, for numbers that count or tick. */
  tabular?: boolean;
  /** The person's words (§2.7): italic. */
  italic?: boolean;
  /** Single-line labels may truncate; prose never sets this. */
  numberOfLines?: number;
  /** Default: `header` for largeTitle, title1 and title2, plain text otherwise. */
  accessibilityRole?: AccessibilityRole;
  /** Layout only (margins, alignment); colour and type come from the props above. */
  style?: StyleProp<TextStyle>;
}

export function Text({ children, type = 'body', color = 'text', header = false, tabular = false, italic = false, numberOfLines, accessibilityRole, style }: Readonly<TextProps>) {
  const t = useTokens();
  const face: TextStyle = {
    ...wrappingType(type, header),
    color: t.colors[color],
    ...(tabular ? TABULAR : {}),
    ...(italic ? { fontStyle: 'italic' as const } : {}),
  };
  return (
    <RNText
      style={[style, face]}
      numberOfLines={numberOfLines}
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      accessibilityRole={accessibilityRole ?? (HEADER_TYPES.has(type) ? 'header' : 'text')}
    >
      {children}
    </RNText>
  );
}
