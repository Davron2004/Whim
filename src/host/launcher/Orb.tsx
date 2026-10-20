// ─────────────────────────────────────────────────────────────────────────────
// Orb — the running app's way back to Whim (`app-launcher` "The orb is an opaque, draggable disc that
// opens the Whim sheet"; system.md §7.1 Orb, §4.3 rule 6, M16, M23).
// ─────────────────────────────────────────────────────────────────────────────
// A host-layer sibling of the WebView, never inside it: the realm can neither touch, cover, move nor
// hide it. An opaque 44 pt `raised` disc with the 20 pt ember, in a 52 pt target, resting 16 pt from
// the side and the bottom safe area, bottom-trailing or bottom-leading, inside the `chromeInsetBottom`
// the app pads by. A drag tracks the finger after the 10 pt slop and its release projects to a corner
// (`orb-geometry.ts`), which each app remembers (`orb-corner.ts`). It fades out while the keyboard is
// up, on the host's own keyboard signal. Its colours follow the phone live, not the app's launch
// theme: the edge is the `border` role, which stands 3:1 off `bg` and off a card in both schemes, so
// the dark disc never sinks into a dark app.
//
// A tap opens the Whim sheet (`onOpen`, `WhimSheet.tsx`). The tapped menu below (shell-redesign-v2
// chain-G, design D12), whose actions are counted (orb-actions.ts), answers a tap only where no
// `onOpen` is given, until task 19.5 retires it.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated as RNAnimated, Easing, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { KeyboardController, KeyboardEvents } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { SPACE } from '../../design/tokens';
import { FONT_FAMILY, MOTION, RADIUS, SHELL_COLORS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { haptics } from '../haptics';
import { Ember, RESTING_ACTIVITY } from '../ui/Ember';
import { timing, usePressFeedback } from '../ui/motion';
import { DRAG_SLOP } from '../ui/Sheet';
import { useTokens } from '../ui/tokens';
import { makeStyles, springConfig } from '../ui/tokens-pure';
import { createMmkvBackend } from '../version-store/fs/mmkv-backend';
import { COPY } from './copy';
import {
  ORB_ACTIONS,
  ORB_ROW_GLYPH,
  ORB_ROW_TINT,
  orbRowGlyphColor,
  recordOrbAction,
  type OrbActionId,
} from './orb-actions';
import { loadOrbCorner, saveOrbCorner, type OrbCorner } from './orb-corner';
import { ORB_DISC, ORB_TARGET, ORB_TARGET_EDGE, orbBounds, orbDragLift, orbDragX, orbReleaseX, orbSettleVelocity } from './orb-geometry';

// The menu rises from the bottom edge — the edge it collapses back to on close/dismiss (design
// doc "Sheet rise": "Sheets enter from the edge they will return to").
const MENU_RISE_DISTANCE = 24;

/** What the orb shows: at rest; a change being made (the ember follows the stream); a new version
 *  ready or an app finished (an `ember` dot, after one flare); a change that failed (a `danger` dot). */
type OrbState = 'rest' | 'changing' | 'ready' | 'failed';

/** The words a screen reader hears after "Whim menu" for each state. */
const STATE_WORDS: Readonly<Record<OrbState, string | null>> = {
  rest: null,
  changing: COPY.orbStateChanging,
  ready: COPY.orbStateReady,
  failed: COPY.orbStateFailed,
};

/** The state dot's side, and its colour role in each state. */
const DOT = 8;
const DOT_ROLE: Readonly<Record<OrbState, 'ember' | 'danger' | null>> = { rest: null, changing: null, ready: 'ember', failed: 'danger' };

/** The orb's one custom accessibility action. */
const MOVE_ACTION = 'move-corner';
const ACCESSIBILITY_ACTIONS = [{ name: MOVE_ACTION, label: COPY.orbMoveCorner }];

// What the drag's release animates with, worked out here on the JS thread: the release runs on the
// UI thread, where `springConfig` and `timing` are not worklets and a call to one ends the app.
const FLING = springConfig('fling');
const FADE_OUT = timing('fadeOut', true);
const FADE_IN = timing('fadeIn', true);
/** A move with no motion, the middle of a Reduce Motion cross-fade. */
const JUMP = { duration: 0 };

const prepareCommit = () => haptics.prepare('commit');
const playCommit = () => haptics.play('commit');

/** Whether the keyboard is up, by the host's own keyboard signal (react-native-keyboard-controller,
 *  which KeyboardShell pads by): up from the moment it starts to rise until it starts to fall. */
function useKeyboardUp(): boolean {
  const [up, setUp] = useState(() => KeyboardController.isVisible());
  useEffect(() => {
    const subscriptions = [
      KeyboardEvents.addListener('keyboardWillShow', () => setUp(true)),
      KeyboardEvents.addListener('keyboardDidShow', () => setUp(true)),
      KeyboardEvents.addListener('keyboardWillHide', () => setUp(false)),
      KeyboardEvents.addListener('keyboardDidHide', () => setUp(false)),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, []);
  return up;
}

export interface OrbProps {
  /** The running app's launcher id: the orb's corner is remembered under it. */
  appId: string;
  /** Default `rest`. */
  state?: OrbState;
  /** The stream's activity (0–1) while a change is being made. */
  activity?: number;
  /** A tap opens the Whim sheet. Without it a tap toggles the tapped menu below, until task 19.5
   *  retires that menu and the callbacks after this one. */
  onOpen?: () => void;
  onExit?: () => void;
  /** Opens the real History screen for the running app ("Versions"). */
  onVersions?: () => void;
  /** Opens the compose step prefilled for the running app ("Change it") — the same path
   *  History's own "Change it from here" row action uses. */
  onChangeIt?: () => void;
  /** Opens the report sheet for the running app (design D13) — sends nothing on its own. */
  onReport?: () => void;
}

export default function Orb({ appId, state = 'rest', activity = 0, onOpen, onExit, onVersions, onChangeIt, onReport }: Readonly<OrbProps>) {
  // Same `whim.launcher` KVBackend id every other launcher setting persists through (see
  // highlighting.ts) — a second MMKV instance opened with the same id shares the same storage.
  const kv = useRef(createMmkvBackend('whim.launcher')).current;
  const t = useTokens();
  const s = styles(t);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { leading, trailing } = orbBounds(width, insets);
  const [corner, setCorner] = useState<OrbCorner>(() => loadOrbCorner(kv, appId));
  const keyboardUp = useKeyboardUp();
  const press = usePressFeedback('icon', t);

  // The target's left edge (`x`), how far a drag lifts it (`lift`), the corner it rests in (`rest`,
  // as an x), the corners themselves, and two opacities: the keyboard's veil and the cross-fade a
  // Reduce Motion release settles by.
  const home = corner === 'leading' ? leading : trailing;
  const x = useSharedValue(home);
  const lift = useSharedValue(0);
  const rest = useSharedValue(home);
  const lead = useSharedValue(leading);
  const trail = useSharedValue(trailing);
  const reduced = useSharedValue(t.reduceMotion);
  const veil = useSharedValue(keyboardUp ? 0 : 1);
  const fade = useSharedValue(1);
  const startX = useSharedValue(0);
  const slopX = useSharedValue(0);
  const slopY = useSharedValue(0);
  const crossing = useSharedValue(false);

  // A new screen size (rotation, split screen) moves the corners: the orb follows its own at once.
  // A drag or the accessibility action has already set `rest` to the corner it went to.
  useEffect(() => {
    lead.value = leading;
    trail.value = trailing;
    if (rest.value !== home) {
      rest.value = home;
      x.value = home;
    }
  }, [home, leading, trailing, lead, trail, rest, x]);
  useEffect(() => {
    reduced.value = t.reduceMotion;
  }, [reduced, t.reduceMotion]);
  useEffect(() => {
    veil.value = withTiming(keyboardUp ? 0 : 1, timing(keyboardUp ? 'fadeOut' : 'fadeIn', true));
  }, [keyboardUp, veil]);

  const settled = useCallback((to: OrbCorner) => {
    setCorner(to);
    saveOrbCorner(kv, appId, to);
  }, [kv, appId]);

  const drag = usePanGesture({
    minDistance: DRAG_SLOP,
    onBegin: () => {
      'worklet';
      scheduleOnRN(prepareCommit);
    },
    onActivate: (e) => {
      'worklet';
      startX.value = x.value;
      slopX.value = e.translationX;
      slopY.value = e.translationY;
      crossing.value = false;
    },
    onUpdate: (e) => {
      'worklet';
      x.value = orbDragX(startX.value, e.translationX - slopX.value, lead.value, trail.value);
      lift.value = orbDragLift(e.translationY - slopY.value);
      const crosses = orbReleaseX(rest.value, x.value, e.velocityX, lead.value, trail.value) !== rest.value;
      if (crosses && !crossing.value) scheduleOnRN(playCommit);
      crossing.value = crosses;
    },
    onDeactivate: (e) => {
      'worklet';
      const to = orbReleaseX(rest.value, x.value, e.velocityX, lead.value, trail.value);
      rest.value = to;
      if (reduced.value) {
        fade.value = withSequence(withTiming(0, FADE_OUT), withTiming(1, FADE_IN));
        x.value = withSequence(withTiming(x.value, FADE_OUT), withTiming(to, JUMP));
        lift.value = withSequence(withTiming(lift.value, FADE_OUT), withTiming(0, JUMP));
      } else {
        x.value = withSpring(to, { ...FLING, velocity: orbSettleVelocity(x.value, to, e.velocityX) });
        lift.value = withSpring(0, { ...FLING, velocity: -e.velocityY });
      }
      scheduleOnRN(settled, to === lead.value ? 'leading' : 'trailing');
    },
  });

  const moveToOtherCorner = () => {
    const to: OrbCorner = corner === 'leading' ? 'trailing' : 'leading';
    const target = to === 'leading' ? leading : trailing;
    rest.value = target;
    if (t.reduceMotion) {
      fade.value = withSequence(withTiming(0, FADE_OUT), withTiming(1, FADE_IN));
      x.value = withSequence(withTiming(x.value, FADE_OUT), withTiming(target, JUMP));
    } else {
      x.value = withSpring(target, FLING);
    }
    settled(to);
  };

  const frameStyle = useAnimatedStyle(() => ({
    opacity: veil.value * fade.value,
    transform: [{ translateX: x.value }, { translateY: -lift.value }],
  }));

  // The flare plays each time a new version becomes ready (the ember's `spark` changes).
  const [flare, setFlare] = useState({ state, count: 0 });
  if (flare.state !== state) setFlare({ state, count: flare.count + (state === 'ready' ? 1 : 0) });

  const [menuOpen, setMenuOpen] = useState(false);
  // The rows take taps only once the menu has risen into place. While it rises, a row is drawn
  // somewhere other than where its touch target is, so a quick tap could land on its neighbour
  // (a tap on Versions opened Report on device). A press that begins during the rise is refused,
  // and so never fires on release either.
  const [menuSettled, setMenuSettled] = useState(false);
  const riseAnim = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    if (!menuOpen) {
      riseAnim.setValue(0);
      return;
    }
    RNAnimated.timing(riseAnim, {
      toValue: 1,
      duration: MOTION.sheetRise.durationMs,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMenuSettled(true);
    });
  }, [menuOpen, riseAnim]);

  // Opening or closing, the menu is not settled until a rise completes.
  const closeAll = () => {
    setMenuOpen(false);
    setMenuSettled(false);
  };

  const onOrbPress = () => {
    if (onOpen) {
      onOpen();
      return;
    }
    setMenuOpen((open) => !open);
    setMenuSettled(false);
  };

  const onAction = (id: OrbActionId) => {
    recordOrbAction(kv, id);
    closeAll();
    if (id === 'home') onExit?.();
    else if (id === 'versions') onVersions?.();
    else if (id === 'report') onReport?.();
    else onChangeIt?.();
  };

  const words = STATE_WORDS[state];
  const label = words === null ? COPY.orbMenuOpenLabel : `${COPY.orbMenuOpenLabel}, ${words}`;
  const dotRole = DOT_ROLE[state];
  const dot = dotRole === null ? null : t.colors[dotRole];
  const hidden = keyboardUp;

  return (
    <>
      <Animated.View
        style={[s.frame, { bottom: insets.bottom + ORB_TARGET_EDGE }, frameStyle]}
        pointerEvents={hidden ? 'none' : 'box-none'}
        accessibilityElementsHidden={hidden}
        importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      >
        <GestureDetector gesture={drag}>
          <Pressable
            onPress={onOrbPress}
            onPressIn={press.pressIn}
            onPressOut={press.pressOut}
            style={s.target}
            accessibilityRole="button"
            accessibilityLabel={menuOpen ? COPY.orbMenuCloseLabel : label}
            accessibilityActions={ACCESSIBILITY_ACTIONS}
            onAccessibilityAction={(e) => {
              if (e.nativeEvent.actionName === MOVE_ACTION) moveToOtherCorner();
            }}
          >
            <Animated.View style={[s.disc, press.style]}>
              <Ember size={20} state="working" activity={state === 'changing' ? activity : RESTING_ACTIVITY} spark={flare.count} />
              {dot === null ? null : <View style={[s.dot, { backgroundColor: dot }]} />}
            </Animated.View>
          </Pressable>
        </GestureDetector>
      </Animated.View>

      {menuOpen && (
        // A genuine Modal (SheetModal.tsx's rationale applies here too), not an absolutely-
        // positioned sibling View: it mounts into its own native window, so the dim layer covers
        // the WHOLE window including both system bars. `statusBarTranslucent` and
        // `navigationBarTranslucent` are what make Android draw that window behind the status bar
        // and the navigation bar rather than between them — without them the scrim stops short of
        // the top of the screen (#105) and leaves the navigation bar undimmed, as SheetModal,
        // ConfirmSheet and HomeScreen's sheet already ask.
        //
        // The dismiss layer is a SIBLING behind the actions, never their parent: a touchable is one
        // accessibility element, and a screen reader reads everything inside it as that element —
        // with the actions nested in it, VoiceOver and TalkBack could reach only "Dismiss".
        <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={closeAll}>
          <View
            style={[
              menuStyles.overlay,
              corner === 'leading' ? menuStyles.overlayLeading : menuStyles.overlayTrailing,
              { paddingBottom: insets.bottom + ORB_TARGET_EDGE + ORB_TARGET + SPACING.sm },
            ]}
          >
            <Pressable
              style={menuStyles.scrim}
              onPress={closeAll}
              accessibilityRole="button"
              accessibilityLabel={COPY.orbMenuDismissLabel}
            />
            <RNAnimated.View
              style={[
                menuStyles.menu,
                {
                  opacity: riseAnim,
                  transform: [
                    {
                      translateY: riseAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [MENU_RISE_DISTANCE, 0],
                      }),
                    },
                  ],
                },
              ]}
              onStartShouldSetResponder={() => true}
            >
              {ORB_ACTIONS.map((action) => (
                <Pressable
                  key={action.id}
                  style={menuStyles.row}
                  disabled={!menuSettled}
                  onPress={() => onAction(action.id)}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                >
                  <View style={[menuStyles.rowIcon, { backgroundColor: ORB_ROW_TINT[action.id] }]}>
                    <Text style={[menuStyles.rowIconGlyph, { color: orbRowGlyphColor(action.id) }]}>
                      {ORB_ROW_GLYPH[action.id]}
                    </Text>
                  </View>
                  <Text style={menuStyles.rowLabel}>{action.label}</Text>
                </Pressable>
              ))}
            </RNAnimated.View>
          </View>
        </Modal>
      )}
    </>
  );
}

const styles = makeStyles((t) => ({
  // Places the target; nothing of it is drawn.
  frame: { position: 'absolute' as const, left: 0, width: ORB_TARGET, height: ORB_TARGET },
  target: { width: ORB_TARGET, height: ORB_TARGET, alignItems: 'center' as const, justifyContent: 'center' as const },
  disc: {
    width: ORB_DISC,
    height: ORB_DISC,
    borderRadius: ORB_DISC / 2,
    backgroundColor: t.colors.raised,
    borderWidth: 1,
    borderColor: t.colors.border,
    boxShadow: t.shadows.floating,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  dot: { position: 'absolute' as const, top: SPACE[1], end: SPACE[1], width: DOT, height: DOT, borderRadius: DOT / 2 },
}));

const menuStyles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
  },
  overlayTrailing: { alignItems: 'flex-end', paddingRight: SPACING.lg },
  overlayLeading: { alignItems: 'flex-start', paddingLeft: SPACING.lg },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(24,22,20,0.5)',
  },
  menu: { gap: SPACING.xs, alignItems: 'stretch', minWidth: 212 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    // design html:220 `gap:13px` — no SPACING step equals 13, so it stays a literal (R9).
    gap: 13,
    backgroundColor: SHELL_COLORS.paper,
    borderWidth: 1,
    borderColor: SHELL_COLORS.border,
    borderRadius: RADIUS.card,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  // design html:221 `border-radius:10px` on a 30×30 box — a rounded SQUARE, not a full circle.
  rowIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowIconGlyph: { fontFamily: FONT_FAMILY.sansMedium, fontSize: 15, lineHeight: 15 },
  rowLabel: { ...TYPE_SCALE.bodyEmphatic, color: SHELL_COLORS.text },
});
