/**
 * WhimProse — the ONE React surface for machine-written shell prose (docs/design/system.md §2.7).
 * Every screen that shows the product telling the user something renders through this component;
 * no screen marks prose itself. Marks always render: there is no off-switch (decision #75).
 *
 * Colours follow the phone through `useTokens()`, so a change of scheme or Increase Contrast
 * re-renders the marks with the new roles.
 *
 * Arriving text is NEVER faded or typed in per character (design "Motion" — the words appearing
 * is the animation), which is why this component holds no animation of its own.
 */

import React, { useMemo } from 'react';
import { StyleProp, Text, TextStyle } from 'react-native';
import { useTokens } from '../tokens';
import { renderProse, RenderProseOptions } from './render';
import { proseStyle } from './styles';

export interface WhimProseProps extends Omit<RenderProseOptions, 'colors'> {
  /** Whim's prose to render. Never a label, button, settings row, heading or a field being typed. */
  text: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}

export default function WhimProse({
  text,
  style,
  numberOfLines,
  apps,
  storedPrompt,
  marks,
  statusIndicatorAdjacent,
}: Readonly<WhimProseProps>) {
  const { colors } = useTokens();
  const segments = useMemo(
    () => renderProse(text, { apps, storedPrompt, marks, statusIndicatorAdjacent, colors }),
    [text, apps, storedPrompt, marks, statusIndicatorAdjacent, colors],
  );

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {segments.map((segment, index) =>
        segment.cls === null ? (
          segment.text
        ) : (
          <Text key={`${segment.cls}:${index}`} style={proseStyle(segment)}>
            {segment.text}
          </Text>
        ),
      )}
    </Text>
  );
}
