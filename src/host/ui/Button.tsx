/**
 * Button — the shell's one button (system.md §7.1): a capsule in one of seven variants, three
 * sizes, an optional 20 pt leading icon, busy words instead of a spinner, the `fill` + `text-3`
 * disabled look, a 2 pt focus ring and M1's press. Replaces `PrimaryAction` and every inline
 * button treatment as screens move onto it.
 */

import React, { useState } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { TintName } from '../../design/tokens';
import { RADII, SPACE } from '../../design/tokens';
import type { IconName } from '../../design/icons/names';
import { haptics, type HapticMoment } from '../haptics';
import { Icon } from './Icon';
import { usePressFeedback } from './motion';
import { useTokens } from './tokens';
import {
  buttonColors,
  buttonMetrics,
  hitSlopFor,
  makeStyles,
  MAX_FONT_SCALE,
  PRESS_RETENTION,
  typeStyle,
  type ButtonSize,
  type ButtonVariant,
} from './tokens-pure';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant: ButtonVariant;
  /** Default `large`. */
  size?: ButtonSize;
  /** A 20 pt leading icon (`danger` takes `trash-2` when it fits). */
  icon?: IconName;
  /** The app's tint, for the `tint` variant ("Open it"). */
  tint?: TintName;
  disabled?: boolean;
  /** Busy words ("Sending…"): shown instead of the label while set, and taps are ignored. */
  busy?: string;
  /** A haptic moment this press confirms (e.g. `handoff` for Make it): prepared on touch-down,
   *  played on the press. Plain taps take none (§5). */
  haptic?: HapticMoment;
  accessibilityHint?: string;
}

const FOCUS_RING = { width: 2, gap: 2 } as const;
const ICON_SIZE = 20;

const styles = makeStyles((t) => ({
  capsule: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: SPACE[2],
    borderRadius: RADII.full.radius,
    borderCurve: 'continuous' as const,
    paddingVertical: SPACE[2],
  },
  ring: {
    position: 'absolute' as const,
    top: -(FOCUS_RING.width + FOCUS_RING.gap),
    bottom: -(FOCUS_RING.width + FOCUS_RING.gap),
    left: -(FOCUS_RING.width + FOCUS_RING.gap),
    right: -(FOCUS_RING.width + FOCUS_RING.gap),
    borderWidth: FOCUS_RING.width,
    borderColor: t.colors.text,
    borderRadius: RADII.full.radius,
  },
  label: { flexShrink: 1, textAlign: 'center' as const },
}));

export function Button({ label, onPress, variant, size = 'large', icon, tint, disabled = false, busy, haptic, accessibilityHint }: Readonly<ButtonProps>) {
  const t = useTokens();
  const s = styles(t);
  const press = usePressFeedback('button', t);
  const [pressed, setPressed] = useState(false);
  const [focused, setFocused] = useState(false);
  const colors = buttonColors(t, variant, disabled, tint);
  const metrics = buttonMetrics(size);
  const text = busy ?? label;
  const labelFace = size === 'small' ? { ...typeStyle(metrics.type), fontWeight: '600' as const } : typeStyle(metrics.type);

  return (
    <Pressable
      onPress={() => {
        if (busy !== undefined) return;
        if (haptic) haptics.play(haptic);
        onPress();
      }}
      onPressIn={() => {
        setPressed(true);
        if (haptic && busy === undefined) haptics.prepare(haptic);
        press.pressIn();
      }}
      onPressOut={() => {
        setPressed(false);
        press.pressOut();
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      disabled={disabled}
      hitSlop={hitSlopFor(metrics.height, t)}
      pressRetentionOffset={PRESS_RETENTION}
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, busy: busy !== undefined }}
    >
      <Animated.View
        style={[
          s.capsule,
          { minHeight: metrics.height, paddingHorizontal: metrics.paddingHorizontal, backgroundColor: pressed ? colors.pressedFill : colors.fill },
          press.style,
        ]}
      >
        {icon ? <Icon name={icon} size={ICON_SIZE} color={colors.label} /> : null}
        <RNText style={[s.label, labelFace, { color: colors.label }]} numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {text}
        </RNText>
      </Animated.View>
      {focused ? <View style={s.ring} pointerEvents="none" /> : null}
    </Pressable>
  );
}
