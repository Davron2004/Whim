/**
 * ComposerBar — Home's way into making an app (system.md §9 Your apps; app-launcher "The home grid
 * orders and lays out apps for every text size"): a raised capsule at the bottom that reads
 * "Describe an app…", or the words already typed when a description is in progress (`draft`). Tapping
 * it opens the describe sheet. One line; the draft is cut with an ellipsis.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { LAYOUT, RADII, SPACE } from '../../design/tokens';
import { Icon } from '../ui/Icon';
import { usePressFeedback } from '../ui/motion';
import { Text } from '../ui/Text';
import { useTokens } from '../ui/tokens';
import { makeStyles, PRESS_RETENTION } from '../ui/tokens-pure';
import { COPY } from './copy';

/** The capsule's height, and how far it reaches above the safe area: a toast sits above both. */
export const COMPOSER_BAR = { height: LAYOUT.buttonHeight.large, bottomGap: LAYOUT.actionAreaBottom } as const;
const COMPOSER_CLEARANCE = COMPOSER_BAR.height + COMPOSER_BAR.bottomGap;

/** How far above the safe area a toast must sit on the screen of this kind: clear of the composer on
 *  Home, the safe area itself everywhere else. */
export const toastClearance = (screen: string): number => (screen === 'home' ? COMPOSER_CLEARANCE : 0);

export interface ComposerBarProps {
  /** The description typed so far, if any; the bar shows it in place of the placeholder. */
  draft?: string;
  onPress: () => void;
}

const styles = makeStyles((t) => ({
  frame: { paddingHorizontal: LAYOUT.gutter, paddingBottom: COMPOSER_BAR.bottomGap, paddingTop: SPACE[2] },
  capsule: {
    minHeight: COMPOSER_BAR.height,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACE[3],
    paddingHorizontal: SPACE[4],
    borderRadius: RADII.full.radius,
    borderCurve: 'continuous' as const,
    backgroundColor: t.colors.raised,
    boxShadow: t.shadows.raised,
    borderTopWidth: 1,
    borderColor: t.topHighlight,
  },
  words: { flex: 1 },
}));

export function ComposerBar({ draft, onPress }: Readonly<ComposerBarProps>) {
  const t = useTokens();
  const s = styles(t);
  const press = usePressFeedback('button', t);
  const drafting = draft !== undefined && draft.trim() !== '';
  return (
    <View style={s.frame}>
      <Pressable
        onPress={onPress}
        onPressIn={press.pressIn}
        onPressOut={press.pressOut}
        pressRetentionOffset={PRESS_RETENTION}
        accessibilityRole="button"
        accessibilityLabel={drafting ? `${COPY.homeComposerDraftLabel}: ${draft}` : COPY.homeComposerPlaceholder}
        accessibilityHint={COPY.homeComposerHint}
      >
        <Animated.View style={[s.capsule, press.style]}>
          <Icon name="plus" size={20} color={t.colors['text-2']} />
          <View style={s.words}>
            <Text type="body" color={drafting ? 'text' : 'text-2'} numberOfLines={1}>
              {drafting ? draft : COPY.homeComposerPlaceholder}
            </Text>
          </View>
        </Animated.View>
      </Pressable>
    </View>
  );
}
