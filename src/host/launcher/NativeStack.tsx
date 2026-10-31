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
 * entry still rendered after the platform popped it would be pushed again.
 *
 * A running app is never on this stack (#67): it is a full-screen layer of its own, so there is no
 * edge swipe over it and its Android back keeps its own seam.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import type { NativeSyntheticEvent } from 'react-native';
import { ScreenStack, ScreenStackItem } from 'react-native-screens';
import type { ScreenStackHeaderConfigProps } from 'react-native-screens';
import { SafeAreaView } from 'react-native-safe-area-context';
import { typeStyle } from '../ui/tokens-pure';

export interface StackEntry {
  /** Stable while the entry stays on the stack, so a push or a pop never remounts what is under it. */
  readonly key: string;
  /** The native header's title. Without one the header is hidden and the screen draws its own,
   *  with its own visible back control. */
  readonly title?: string;
  /** The title large under the bar on iOS (Settings). */
  readonly largeTitle?: boolean;
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

function headerFor(entry: StackEntry, root: boolean): ScreenStackHeaderConfigProps {
  if (root || entry.title === undefined) return { hidden: true };
  const title = typeStyle('headline');
  return {
    title: entry.title,
    largeTitle: entry.largeTitle === true,
    backgroundColor: entry.background,
    largeTitleBackgroundColor: entry.background,
    color: entry.foreground,
    titleColor: entry.foreground,
    largeTitleColor: entry.foreground,
    titleFontSize: title.fontSize,
    titleFontWeight: title.fontWeight,
    hideShadow: true,
    largeTitleHideShadow: true,
  };
}

export default function NativeStack({ entries }: Readonly<{ entries: readonly StackEntry[] }>) {
  return (
    <ScreenStack style={styles.fill}>
      {entries.map((entry, index) => {
        const root = index === 0;
        const ownHeader = root || entry.title === undefined;
        return (
          <ScreenStackItem
            key={entry.key}
            screenId={entry.key}
            activityState={2}
            headerConfig={headerFor(entry, root)}
            gestureEnabled={!root}
            contentStyle={{ backgroundColor: entry.background }}
            onDismissed={(event: NativeSyntheticEvent<{ dismissCount: number }>) =>
              entries[poppedEntry(index, event.nativeEvent.dismissCount)].onLeave()
            }
            onHeaderBackButtonClicked={entry.onLeave}
          >
            <SafeAreaView edges={ownHeader ? ['top', 'bottom'] : ['bottom']} style={styles.fill}>
              {entry.children}
            </SafeAreaView>
          </ScreenStackItem>
        );
      })}
    </ScreenStack>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
