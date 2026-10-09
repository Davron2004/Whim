/**
 * IconButton — a 44 × 44 icon control (system.md §7.1): `plain` (the icon in `text`) or `filled`
 * (a 36 pt `fill` disc), icon 24 in headers and 20 elsewhere, press 0.92, always labelled. Android
 * grows the target to 48 dp. `BackButton` is the screen-anatomy back control (§2.8): iOS
 * `chevron-left`, Android `arrow-left`.
 */

import React from 'react';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { RADII } from '../../design/tokens';
import type { IconName } from '../../design/icons/names';
import { COPY } from '../launcher/copy';
import { Icon } from './Icon';
import { usePressFeedback } from './motion';
import { useTokens } from './tokens';
import { hitSlopFor, ICON_BUTTON, makeStyles, PRESS_RETENTION } from './tokens-pure';

export interface IconButtonProps {
  icon: IconName;
  /** What a screen reader says ("Close", "Settings"); required. */
  label: string;
  onPress: () => void;
  /** Default `plain`. */
  variant?: 'plain' | 'filled';
  /** 24 in headers, 20 elsewhere (default). */
  iconSize?: 20 | 24;
  disabled?: boolean;
}

const styles = makeStyles((t) => ({
  box: {
    width: ICON_BUTTON.size,
    height: ICON_BUTTON.size,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  disc: {
    width: ICON_BUTTON.filledDisc,
    height: ICON_BUTTON.filledDisc,
    borderRadius: RADII.full.radius,
    backgroundColor: t.colors.fill,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
}));

export function IconButton({ icon, label, onPress, variant = 'plain', iconSize = 20, disabled = false }: Readonly<IconButtonProps>) {
  const t = useTokens();
  const s = styles(t);
  const press = usePressFeedback('icon', t);
  const glyph = <Icon name={icon} size={iconSize} color={disabled ? t.colors['text-3'] : t.colors.text} />;
  return (
    <Pressable
      onPress={onPress}
      onPressIn={press.pressIn}
      onPressOut={press.pressOut}
      disabled={disabled}
      hitSlop={hitSlopFor(ICON_BUTTON.size, t)}
      pressRetentionOffset={PRESS_RETENTION}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <Animated.View style={[s.box, press.style]}>{variant === 'filled' ? <View style={s.disc}>{glyph}</View> : glyph}</Animated.View>
    </Pressable>
  );
}

export interface BackButtonProps {
  onPress: () => void;
  /** Default `COPY.backLabel`. */
  label?: string;
}

/** The back control of a non-root screen: each platform's own glyph, at header size. */
export function BackButton({ onPress, label = COPY.backLabel }: Readonly<BackButtonProps>) {
  const t = useTokens();
  return <IconButton icon={t.platform === 'ios' ? 'chevron-left' : 'arrow-left'} label={label} onPress={onPress} iconSize={24} />;
}
