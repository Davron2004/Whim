/**
 * Notice — an inline message block (system.md §7.1; replaces `ServiceNotice` as screens move onto
 * it): `r-md`, `fill` with a 20 pt `info` (neutral) or `danger-soft` with `circle-alert`
 * (danger), `callout` text, an optional retry countdown in tabular figures. A danger notice is an
 * alert to screen readers; both are announced politely when they change.
 */

import React from 'react';
import { View } from 'react-native';
import { RADII, SPACE } from '../../design/tokens';
import { Icon } from './Icon';
import { Text } from './Text';
import { useTokens } from './tokens';
import { makeStyles, noticeLook, type NoticeTone } from './tokens-pure';

export interface NoticeProps {
  message: string;
  /** Default `neutral`. */
  tone?: NoticeTone;
  /** A retry countdown, already worded ("Trying again in 0:12"); drawn in tabular figures. */
  countdown?: string;
}

const ICON_SIZE = 20;

const styles = makeStyles(() => ({
  block: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: SPACE[3],
    padding: SPACE[3],
    borderRadius: RADII.md.radius,
    borderCurve: 'continuous' as const,
  },
  body: { flex: 1, gap: SPACE[1] },
}));

export function Notice({ message, tone = 'neutral', countdown }: Readonly<NoticeProps>) {
  const t = useTokens();
  const s = styles(t);
  const look = noticeLook(t, tone);
  return (
    <View
      style={[s.block, { backgroundColor: look.fill }]}
      accessible
      accessibilityRole={tone === 'danger' ? 'alert' : 'text'}
      accessibilityLabel={countdown ? `${message} ${countdown}` : message}
      accessibilityLiveRegion="polite"
    >
      <Icon name={look.icon} size={ICON_SIZE} color={look.iconColor} />
      <View style={s.body}>
        <Text type="callout">{message}</Text>
        {countdown ? (
          <Text type="callout" color="text-2" tabular>
            {countdown}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
