/**
 * Chip — the shell's one pill (system.md §7.1; replaces four pill styles): a 36 pt capsule with a
 * 44/48 target, `callout` 500. A `choice` is selected in `ink` with a 16 pt `check`; "Decide for
 * me" (`decide`) keeps `ember-text` and turns `ember-soft` when picked; a `suggestion` has no
 * selected state. Press 0.96; the fill changes over the `color` timing (kept under Reduce Motion,
 * still across a change of appearance); a selection move plays the selection haptic.
 */

import React, { useEffect, useRef } from 'react';
import { Pressable, Text as RNText } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { RADII, SPACE, TYPE_SCALE } from '../../design/tokens';
import { haptics } from '../haptics';
import { Icon } from './Icon';
import { timing, usePressFeedback } from './motion';
import { useTokens } from './tokens';
import { CHIP, chipColors, hitSlopFor, makeStyles, MAX_FONT_SCALE, PRESS_RETENTION, typeStyle, type ChipKind } from './tokens-pure';

export interface ChipProps {
  label: string;
  onPress: () => void;
  /** Default `choice`. */
  kind?: ChipKind;
  /** Ignored for a `suggestion`. */
  selected?: boolean;
  /** One of several may be picked (a checkbox to screen readers); otherwise a radio. */
  multiple?: boolean;
  disabled?: boolean;
}

/** What the 36 pt pill keeps above and below one `callout` line: at larger text the line grows and the
 *  pill grows with it, instead of the label filling it edge to edge. */
const PADDING_VERTICAL = (CHIP.height - TYPE_SCALE.callout.lineHeight) / 2;

const styles = makeStyles(() => ({
  capsule: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACE[1],
    minHeight: CHIP.height,
    paddingVertical: PADDING_VERTICAL,
    paddingHorizontal: CHIP.paddingHorizontal,
    borderRadius: RADII.full.radius,
    borderCurve: 'continuous' as const,
  },
  label: { ...typeStyle('callout'), fontWeight: '500' as const, flexShrink: 1 },
}));

export function Chip({ label, onPress, kind = 'choice', selected = false, multiple = false, disabled = false }: Readonly<ChipProps>) {
  const t = useTokens();
  const s = styles(t);
  const press = usePressFeedback('chip', t);
  const look = chipColors(t, kind, selected);
  const fill = useSharedValue(look.fill);
  const shown = useRef({ key: t.key, fill: look.fill });
  useEffect(() => {
    const before = shown.current;
    shown.current = { key: t.key, fill: look.fill };
    if (before.fill === look.fill) return;
    // A change of appearance repaints at once (§4.4 "What stays still"); a selection fades.
    fill.value = before.key === t.key ? withTiming(look.fill, timing('color', true)) : look.fill;
  }, [fill, look.fill, t.key]);
  const fillStyle = useAnimatedStyle(() => ({ backgroundColor: fill.value }));
  const selectable = kind !== 'suggestion';
  const labelColor = disabled ? t.colors['text-3'] : look.label;
  let role: 'checkbox' | 'radio' | 'button' = 'button';
  if (selectable) role = multiple ? 'checkbox' : 'radio';

  return (
    <Pressable
      onPress={() => {
        if (selectable) haptics.play('selection');
        onPress();
      }}
      onPressIn={() => {
        if (selectable) haptics.prepare('selection');
        press.pressIn();
      }}
      onPressOut={press.pressOut}
      disabled={disabled}
      hitSlop={hitSlopFor(CHIP.height, t)}
      pressRetentionOffset={PRESS_RETENTION}
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={selectable ? { checked: look.check, disabled } : { disabled }}
    >
      <Animated.View style={[s.capsule, fillStyle, press.style]}>
        {look.check ? <Icon name="check" size={CHIP.check} color={labelColor} /> : null}
        <RNText style={[s.label, { color: labelColor }]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {label}
        </RNText>
      </Animated.View>
    </Pressable>
  );
}
