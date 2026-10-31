/**
 * Text — shell text on the type scale (system.md §2.7): one system family, size / line / weight /
 * tracking from the token, a colour role from `useTokens()`, Dynamic Type up to 200%. Titles are
 * headers to screen readers; counting and ticking numbers take `tabular`.
 */

import React from 'react';
import { Text as RNText, type AccessibilityRole, type StyleProp, type TextStyle } from 'react-native';
import type { ColorRole, TypeToken } from '../../design/tokens';
import { useTokens } from './tokens';
import { MAX_FONT_SCALE, TABULAR, typeStyle } from './tokens-pure';

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
    ...typeStyle(type, header),
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
