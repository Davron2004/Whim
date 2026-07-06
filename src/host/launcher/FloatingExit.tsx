// ─────────────────────────────────────────────────────────────────────────────
// FloatingExit — the always-available exit affordance (launcher-shell / #5 D5).
// ─────────────────────────────────────────────────────────────────────────────
// A small circular button rendered as a HOST-LAYER sibling of the WebView (never inside it —
// the realm can neither touch nor cover it). It is the demoted "home" extra (#42: system back
// is primary). Draggable (PanResponder; snaps to the nearest screen edge on release — the
// answer to §10's overlap risk), auto-dims to low opacity after a short idle, restores to full
// opacity on touch. A tap (no drag) exits to the launcher — unconditionally, out of the realm's
// reach (the third leg of the guaranteed-exit invariant, D4).
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Dimensions, PanResponder, StyleSheet, Text } from 'react-native';

const SIZE = 52;
const MARGIN = 14;
const IDLE_MS = 3000; // dim after ~3s idle
const DIM_OPACITY = 0.28;
const DRAG_THRESHOLD = 6; // px of movement before a gesture counts as a drag (not a tap)

export interface FloatingExitProps {
  onPress: () => void;
}

export default function FloatingExit({ onPress }: Readonly<FloatingExitProps>) {
  const { width, height } = Dimensions.get('window');
  const startX = width - SIZE - MARGIN;
  const startY = height - SIZE - MARGIN * 6;

  const pan = useRef(new Animated.ValueXY({ x: startX, y: startY })).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the current value so snap math + drag offset work without reading private fields.
  const cur = useRef({ x: startX, y: startY });

  useEffect(() => {
    const id = pan.addListener((v) => { cur.current = v; });
    return () => pan.removeListener(id);
  }, [pan]);

  const armIdle = useMemo(
    () => () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: DIM_OPACITY, duration: 400, useNativeDriver: true }).start();
      }, IDLE_MS);
    },
    [opacity],
  );

  const restore = useMemo(
    () => () => {
      Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true }).start();
      armIdle();
    },
    [opacity, armIdle],
  );

  useEffect(() => {
    armIdle();
    return () => { if (idleTimer.current) clearTimeout(idleTimer.current); };
  }, [armIdle]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > DRAG_THRESHOLD || Math.abs(g.dy) > DRAG_THRESHOLD,
        onPanResponderGrant: () => {
          restore();
          // Begin dragging from the current resting position.
          pan.setOffset({ x: cur.current.x, y: cur.current.y });
          pan.setValue({ x: 0, y: 0 });
        },
        onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
        onPanResponderRelease: (_e, g) => {
          pan.flattenOffset();
          const moved = Math.abs(g.dx) > DRAG_THRESHOLD || Math.abs(g.dy) > DRAG_THRESHOLD;
          if (!moved) {
            onPress();
            return;
          }
          // Snap to the nearest horizontal edge; clamp Y to the visible area.
          const x = cur.current.x;
          const y = Math.max(MARGIN, Math.min(cur.current.y, height - SIZE - MARGIN));
          const snapX = x + SIZE / 2 < width / 2 ? MARGIN : width - SIZE - MARGIN;
          Animated.spring(pan, { toValue: { x: snapX, y }, useNativeDriver: false, friction: 7 }).start();
          armIdle();
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [pan, restore, armIdle, onPress, width, height],
  );

  return (
    <Animated.View
      {...responder.panHandlers}
      style={[styles.btn, { opacity, transform: pan.getTranslateTransform() }]}
      accessibilityRole="button"
      accessibilityLabel="Exit to home"
    >
      <Text style={styles.glyph}>⌂</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  btn: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
    // a soft shadow so it reads as a floating layer above the app
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  glyph: { color: '#bfdbfe', fontSize: 24, fontWeight: '700', marginTop: -2 },
});
