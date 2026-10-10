/**
 * ScrollEdgeFade — the soft edge a scrolling list leaves under a header or above the composer
 * (system.md §9 Your apps: "scroll-edge fades top and bottom"): the screen's `bg` fading to clear,
 * drawn over the list and never taking a touch.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { SPACE } from '../../design/tokens';
import { useTokens } from '../ui/tokens';

export const EDGE_FADE_HEIGHT = SPACE[4];

const styles = StyleSheet.create({
  fade: { position: 'absolute', left: 0, right: 0, height: EDGE_FADE_HEIGHT },
  top: { top: 0 },
  bottom: { bottom: 0 },
});

export function ScrollEdgeFade({ edge }: Readonly<{ edge: 'top' | 'bottom' }>) {
  const t = useTokens();
  const top = edge === 'top';
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.fade, top ? styles.top : styles.bottom]}
    >
      <Svg width="100%" height={EDGE_FADE_HEIGHT}>
        <Defs>
          <LinearGradient id={`fade-${edge}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={t.colors.bg} stopOpacity={top ? 1 : 0} />
            <Stop offset="1" stopColor={t.colors.bg} stopOpacity={top ? 0 : 1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height={EDGE_FADE_HEIGHT} fill={`url(#fade-${edge})`} />
      </Svg>
    </View>
  );
}
