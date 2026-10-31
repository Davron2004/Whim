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
// A tap opens the Whim sheet (`onOpen`, `WhimSheet.tsx`).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { KeyboardController, KeyboardEvents } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { SPACE } from '../../design/tokens';
import { haptics } from '../haptics';
import { Ember, RESTING_ACTIVITY } from '../ui/Ember';
import type { FlickerPulse } from './home-live';
import { timing, usePressFeedback } from '../ui/motion';
import { DRAG_SLOP, releaseCommit, startCommit, stepCommit, type DragCommit } from '../ui/Sheet';
import { useTokens } from '../ui/tokens';
import { makeStyles, springConfig } from '../ui/tokens-pure';
import { createMmkvBackend } from '../version-store/fs/mmkv-backend';
import { COPY } from './copy';
import { loadOrbCorner, saveOrbCorner, type OrbCorner } from './orb-corner';
import { ORB_DISC, ORB_TARGET, ORB_TARGET_EDGE, orbAcross, orbBounds, orbDragLift, orbDragX, orbOtherCorner, orbReleaseX, orbSettleVelocity } from './orb-geometry';

/** What the orb shows: at rest; a change being made (the ember follows the stream); a new version
 *  ready, or another app finished (an `ember` dot, after one flare); a change that failed (a `danger` dot). */
type OrbState = 'rest' | 'changing' | 'ready' | 'finished' | 'failed';

/** The words a screen reader hears after "Whim menu" for each state. */
const STATE_WORDS: Readonly<Record<OrbState, string | null>> = {
  rest: null,
  changing: COPY.orbStateChanging,
  ready: COPY.orbStateReady,
  finished: COPY.orbStateFinished,
  failed: COPY.orbStateFailed,
};

/** The state dot's side, and its colour role in each state. */
const DOT = 8;
const DOT_ROLE: Readonly<Record<OrbState, 'ember' | 'danger' | null>> = { rest: null, changing: null, ready: 'ember', finished: 'ember', failed: 'danger' };

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
  /** The change's flicker pulse (system.md §4.6), while it is being made. */
  flicker?: FlickerPulse;
  /** The change's stream stalled: the ember is stuck. */
  stuck?: boolean;
  /** A tap opens the Whim sheet. */
  onOpen: () => void;
}

export default function Orb({ appId, state = 'rest', activity = 0, flicker, stuck = false, onOpen }: Readonly<OrbProps>) {
  // The corner persists through the same `whim.launcher` KVBackend id every other launcher setting
  // uses — a second MMKV instance opened with the same id shares the same storage.
  const kv = useRef(createMmkvBackend('whim.launcher')).current;
  const t = useTokens();
  const s = styles(t);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { leading, trailing } = orbBounds(width, insets);
  const [corner, setCorner] = useState<OrbCorner>(() => loadOrbCorner(kv, appId));
  const keyboardUp = useKeyboardUp();
  const press = usePressFeedback('icon', t);
  const changing = state === 'changing';

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
  const commit = useSharedValue<DragCommit>(startCommit(0));

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
      commit.value = startCommit((x.value - rest.value) * orbAcross(rest.value, lead.value, trail.value));
    },
    onUpdate: (e) => {
      'worklet';
      x.value = orbDragX(startX.value, e.translationX - slopX.value, lead.value, trail.value);
      lift.value = orbDragLift(e.translationY - slopY.value);
      const across = orbAcross(rest.value, lead.value, trail.value);
      const crosses = orbReleaseX(rest.value, x.value, e.velocityX, lead.value, trail.value) !== rest.value;
      const middle = Math.abs(trail.value - lead.value) / 2;
      const next = stepCommit(commit.value, (x.value - rest.value) * across, crosses, middle);
      if (next.armed && !commit.value.armed) scheduleOnRN(playCommit);
      commit.value = next;
    },
    onDeactivate: (e) => {
      'worklet';
      const across = orbAcross(rest.value, lead.value, trail.value);
      const crosses = orbReleaseX(rest.value, x.value, e.velocityX, lead.value, trail.value) !== rest.value;
      const middle = Math.abs(trail.value - lead.value) / 2;
      // A drag the system took away (cancelled, failed) never commits: back to its own corner.
      const released = e.canceled
        ? startCommit(0)
        : releaseCommit(commit.value, (x.value - rest.value) * across, e.velocityX * across, crosses, middle);
      if (released.armed && !commit.value.armed) scheduleOnRN(playCommit);
      commit.value = released;
      const to = released.armed ? orbOtherCorner(rest.value, lead.value, trail.value) : rest.value;
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

  // The flare plays each time the ember dot comes (the ember's `spark` changes).
  const [flare, setFlare] = useState({ state, count: 0 });
  if (flare.state !== state) setFlare({ state, count: flare.count + (DOT_ROLE[state] === 'ember' ? 1 : 0) });

  const words = STATE_WORDS[state];
  const label = words === null ? COPY.orbMenuOpenLabel : `${COPY.orbMenuOpenLabel}, ${words}`;
  const dotRole = DOT_ROLE[state];
  const dot = dotRole === null ? null : t.colors[dotRole];
  const hidden = keyboardUp;

  return (
    <Animated.View
      style={[s.frame, { bottom: insets.bottom + ORB_TARGET_EDGE }, frameStyle]}
      pointerEvents={hidden ? 'none' : 'box-none'}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
    >
      <GestureDetector gesture={drag}>
        <Pressable
          onPress={onOpen}
          onPressIn={press.pressIn}
          onPressOut={press.pressOut}
          style={s.target}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityActions={ACCESSIBILITY_ACTIONS}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === MOVE_ACTION) moveToOtherCorner();
          }}
        >
          <Animated.View style={[s.disc, press.style]}>
            <Ember
              size={20}
              state={changing && stuck ? 'stuck' : 'working'}
              activity={changing ? activity : RESTING_ACTIVITY}
              flicker={changing ? flicker : undefined}
              spark={flare.count}
            />
            {dot === null ? null : <View style={[s.dot, { backgroundColor: dot }]} />}
          </Animated.View>
        </Pressable>
      </GestureDetector>
    </Animated.View>
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
