/**
 * AppCrashed — the crash screen, in the app's place when a running app fails (`app-launcher` "A crashed
 * app keeps the orb and offers a way forward"; system.md §9 App crashed): `circle-alert` in a `fill`
 * circle, "<name> ran into a problem", that it stopped and the saved data is safe, then Reload (`ink`),
 * Ask Whim to fix it (`plain-ember`) and Back to your apps (`plain`). The orb stays over it
 * (`MiniAppView`).
 *
 * A launch behind its app's current version (a change landed, an Undo moved the app, since it opened)
 * says so instead and offers Reload and Back only: the error is from code no longer current, and a
 * change is made from the current version, so a fix is offered once Reload runs that one.
 *
 * It sits in the app's area, so it is drawn in the tokens the launch was delivered with (design-system-v1
 * 18g), not the phone's live ones. Nothing of the realm's error is shown here: the error goes, as plain
 * text, only into the request "Ask Whim to fix it" prefills (`crash-report.ts`).
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { LAYOUT, SPACE } from '../../design/tokens';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Text } from '../ui/Text';
import type { ShellTokens } from '../ui/tokens-pure';
import { appCrashedTitle, COPY } from './copy';

export interface AppCrashedProps {
  name: string;
  /** The tokens the launch's frame is held to. */
  tokens: ShellTokens;
  /** Below this the orb sits: the actions end above it. */
  bottomClearance: number;
  /** A newer version of the app than this launch runs is current: no "Ask Whim to fix it". */
  behind: boolean;
  onReload: () => void;
  onAskFix: () => void;
  onExit: () => void;
}

/** §2.8 EmptyState's mark: a 32 pt icon in a 64 pt `fill` circle. */
const MARK = { circle: 64, icon: 32 } as const;

/** The mark, title and body centred in the space above the actions; the actions at the bottom, just
 *  above the orb (the mockups' `#app-error`). At large text sizes the whole screen scrolls. */
export function AppCrashed({ name, tokens, bottomClearance, behind, onReload, onAskFix, onExit }: Readonly<AppCrashedProps>) {
  const c = tokens.colors;
  return (
    <ScrollView
      style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]}
      contentContainerStyle={[styles.content, { paddingBottom: bottomClearance }]}
    >
      <View style={styles.message}>
        <View style={[styles.mark, { backgroundColor: c.fill }]}>
          <Icon name="circle-alert" size={MARK.icon} color={c.text} />
        </View>
        <Text tokens={tokens} type="title2" style={styles.title}>{appCrashedTitle(name)}</Text>
        <Text tokens={tokens} color="text-2" style={styles.centred}>{behind ? COPY.appCrashedBehindBody : COPY.appCrashedBody}</Text>
      </View>
      <View style={styles.actions}>
        <Button tokens={tokens} label={COPY.actionReload} variant="ink" onPress={onReload} />
        {behind ? null : <Button tokens={tokens} label={COPY.appCrashedAskFix} variant="plain-ember" onPress={onAskFix} />}
        <Button tokens={tokens} label={COPY.launchFailedBack} variant="plain" onPress={onExit} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: LAYOUT.gutter, paddingTop: SPACE[8] },
  // Takes all the height the actions leave, and centres the mark, title and body in it.
  message: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: LAYOUT.gapBetweenSections },
  mark: { width: MARK.circle, height: MARK.circle, borderRadius: MARK.circle / 2, alignItems: 'center', justifyContent: 'center', marginBottom: SPACE[5] },
  title: { textAlign: 'center', marginBottom: SPACE[2] },
  actions: { gap: SPACE[2] },
  centred: { textAlign: 'center' },
});
