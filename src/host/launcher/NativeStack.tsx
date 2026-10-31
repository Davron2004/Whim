/**
 * NativeStack — the shell's pushed screens on react-native-screens' native stack (design-system-v1
 * D6; spec launcher-screen-exits "Pushed shell screens sit on the native stack"). Home is the root;
 * Settings, Advanced, AI features, History and Report are pushed over it. The platform draws every
 * transition: iOS gives the edge and content-area swipe and the header back (with its long-press
 * menu), Android its header back and predictive back. Whim draws none of it.
 *
 * `LauncherRoot`'s machine stays the one source of truth: the entries are rendered from its state,
 * and every native pop writes back to it through the popped entry's `onLeave`, the same handler the
 * screen binds to system back. So `onLeave` must move the machine off its entry synchronously: an
 * entry still rendered after the platform popped it would be pushed again. Only the top entry's
 * screen answers system back (`SystemBackOnTop`), whatever order the screens' listeners were bound in,
 * and none does while something over the stack owns back (`backOverlaid`, the store age check).
 *
 * A running app is never on this stack (#67): it is a full-screen layer of its own, so there is no
 * edge swipe over it and its Android back keeps its own seam.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import type { NativeSyntheticEvent } from 'react-native';
import { ScreenStack, ScreenStackHeaderCenterView, ScreenStackItem } from 'react-native-screens';
import type { ScreenStackHeaderConfigProps } from 'react-native-screens';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTokens } from '../ui/tokens';
import { SystemBackOnTop } from './use-system-back-with';

export interface StackEntry {
  /** Stable while the entry stays on the stack, so a push or a pop never remounts what is under it. */
  readonly key: string;
  /** The screen's name. With one, the native header shows the back control and the screen draws its
   *  title in its content (system.md §2.8 screen anatomy: `largeTitle` on Settings, `title1` on the
   *  others), so the header's inline title stays blank; the name still labels the screen in the iOS
   *  back button and its long-press menu (#237). Without one the header is hidden and the screen
   *  draws its own, with its own visible back control. The root's header is always hidden (Home
   *  draws its own), its title only naming it in that menu. */
  readonly title?: string;
  /** Leaves this entry: the header back, a swipe and the screen's own system back all run it. */
  readonly onLeave: () => void;
  /** The screen's background, which its header shares and which shows while it moves. */
  readonly background: string;
  /** The header's title and back control colour: the screen's text colour. */
  readonly foreground: string;
  readonly children: React.ReactNode;
}

/**
 * The entry a native pop of `dismissCount` screens from position `top` leaves through: the lowest
 * one popped. iOS pops several at once from the back button's long-press menu; leaving the lowest
 * popped entry lands exactly where the platform did. Never the root.
 */
export function poppedEntry(top: number, dismissCount: number): number {
  return Math.max(1, top - Math.max(1, dismissCount) + 1);
}

/** The header of a pushed entry with a title: the back control over a blank inline title, an empty
 *  centre view standing in the title's place on both platforms (iOS draws the centre view instead of
 *  the title, Android clears the toolbar's title for it), while `title` still names the screen in the
 *  iOS back button and its long-press menu. At large text (system.md §6) the iOS back button is its
 *  chevron alone (#218): the title of the screen it returns to, at that size, truncated to "S…gs"
 *  beside this screen's own. VoiceOver reads it as "Back". */
function headerFor(entry: StackEntry, root: boolean, largeText: boolean): ScreenStackHeaderConfigProps {
  if (entry.title === undefined) return { hidden: true };
  if (root) return { hidden: true, title: entry.title };
  return {
    title: entry.title,
    ...(largeText ? { backButtonDisplayMode: 'minimal' as const } : {}),
    backgroundColor: entry.background,
    color: entry.foreground,
    titleColor: entry.foreground,
    hideShadow: true,
    children: <ScreenStackHeaderCenterView />,
  };
}

interface NativeStackProps {
  readonly entries: readonly StackEntry[];
  /** A push or pop the platform was drawing has finished (react-native-screens' `onFinishTransitioning`:
   *  UIKit's `didShowViewController` on iOS, the fragment animation's end on Android). */
  readonly onSettled?: () => void;
  /** Something drawn over the stack answers system back itself (`LauncherRoot`'s age check): no entry
   *  does, however recently its screen mounted again. */
  readonly backOverlaid?: boolean;
}

export default function NativeStack({ entries, onSettled, backOverlaid = false }: Readonly<NativeStackProps>) {
  const { largeText } = useTokens();
  return (
    <ScreenStack style={styles.fill} onFinishTransitioning={onSettled}>
      {entries.map((entry, index) => {
        const root = index === 0;
        const ownHeader = root || entry.title === undefined;
        return (
          <ScreenStackItem
            key={entry.key}
            screenId={entry.key}
            activityState={2}
            headerConfig={headerFor(entry, root, largeText)}
            gestureEnabled={!root}
            contentStyle={{ backgroundColor: entry.background }}
            onDismissed={(event: NativeSyntheticEvent<{ dismissCount: number }>) =>
              entries[poppedEntry(index, event.nativeEvent.dismissCount)].onLeave()
            }
            onHeaderBackButtonClicked={entry.onLeave}
          >
            <SafeAreaView edges={ownHeader ? ['top', 'bottom'] : ['bottom']} style={styles.fill}>
              <SystemBackOnTop.Provider value={!backOverlaid && index === entries.length - 1}>{entry.children}</SystemBackOnTop.Provider>
            </SafeAreaView>
          </ScreenStackItem>
        );
      })}
    </ScreenStack>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
