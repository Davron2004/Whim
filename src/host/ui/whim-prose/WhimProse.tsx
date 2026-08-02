/**
 * WhimProse — the ONE React surface for machine-written shell prose (design D7). Every screen
 * that shows the product telling the user something renders through this component; no screen
 * highlights prose itself.
 *
 * The off-switch reaches every screen through `HighlightingProvider`, not through a prop drilled
 * down five levels: the launcher reads the persisted flag once (`loadHighlighting`) and wraps its
 * tree, so a screen whose props signature is fixed (History) still flattens with the switch.
 *
 * Arriving text is NEVER faded or typed in per character (design "Motion" — the words appearing
 * is the animation), which is why this component holds no animation of its own.
 */

import React, { createContext, useContext, useMemo } from 'react';
import { StyleProp, Text, TextStyle } from 'react-native';
import { renderProse, RenderProseOptions } from './render';
import { proseStyle } from './styles';

/** Default ON: an absent provider, like an absent or unreadable stored value, means highlighting
 *  is on — never a crash and never a silently flat shell. */
const HighlightingContext = createContext<boolean>(true);

export function HighlightingProvider({
  enabled,
  children,
}: Readonly<{ enabled: boolean; children: React.ReactNode }>) {
  return <HighlightingContext.Provider value={enabled}>{children}</HighlightingContext.Provider>;
}

/** The active off-switch value, for a surface that needs it outside `WhimProse`. */
export function useHighlighting(): boolean {
  return useContext(HighlightingContext);
}

export interface WhimProseProps extends Omit<RenderProseOptions, 'highlighting'> {
  /** The agent prose to render. Never a label, button, settings row or heading (rule 7). */
  text: string;
  /** Overrides the provider's flag; omitted, the provider decides. */
  highlighting?: boolean;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}

export default function WhimProse({
  text,
  style,
  numberOfLines,
  highlighting,
  apps,
  storedPrompt,
  marks,
  statusIndicatorAdjacent,
  onInk,
}: Readonly<WhimProseProps>) {
  const enabled = useHighlighting();
  const segments = useMemo(
    () =>
      renderProse(text, {
        apps,
        storedPrompt,
        marks,
        statusIndicatorAdjacent,
        onInk,
        highlighting: highlighting ?? enabled,
      }),
    [text, apps, storedPrompt, marks, statusIndicatorAdjacent, onInk, highlighting, enabled],
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
