// ─────────────────────────────────────────────────────────────────────────────
// SettingsScreen — the theme picker (preset / accent / corners) for the launcher shell
// (design sdk-design-system, D3/D7).
// ─────────────────────────────────────────────────────────────────────────────
// A pure settings surface: every tap calls `setPref` on the theme context, which re-resolves
// `theme` and re-renders live (this screen included) — there is no separate "apply" step.
// Colors come only from `shellPalette(theme)` plus the SDK's own curated preset/accent color
// values (`PRESETS`/`ACCENTS` from `vc-sdk`'s theme module) — never a hex literal of its own.
// This screen is not a mini-app host: it owns its own hardware-back binding directly, and never
// touches `BackPolicy` (which only ever binds inside `useMiniAppHost`).
import React, { useEffect } from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ACCENTS, PRESETS, ThemeShape } from '../../sdk/theme';
import { accentLabel, COPY, presetLabel } from './copy';
import { shellPalette } from './theme';
import { useTheme } from './theme-context';

const SHAPES: readonly ThemeShape[] = ['sharp', 'soft', 'round'];
const SHAPE_LABEL: Record<ThemeShape, string> = {
  sharp: COPY.shapeSharp,
  soft: COPY.shapeSoft,
  round: COPY.shapeRound,
};

export interface SettingsScreenProps {
  /** Returns to the home screen — supplied by `LauncherRoot`. */
  onBack: () => void;
}

const TRANSPARENT = 'transparent';

export default function SettingsScreen({ onBack }: Readonly<SettingsScreenProps>) {
  const { theme, pref, setPref } = useTheme();
  const p = shellPalette(theme);
  const defaultAccentSelected = !pref.accent;
  const defaultRingColor = defaultAccentSelected ? p.text : TRANSPARENT;
  const defaultRingWidth = defaultAccentSelected ? 2 : 0;

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  const selectPreset = (id: string) => setPref({ ...pref, preset: id });
  const selectAccent = (id: string) => setPref({ ...pref, accent: id });

  const clearAccent = () => {
    const next = { ...pref };
    delete next.accent;
    setPref(next);
  };

  // Tapping the shape that's already the active override clears it back to the preset default;
  // tapping any other shape sets an explicit override. Simpler than a fourth "preset default"
  // button, and every state is reachable (tap the active pill twice to round-trip).
  const toggleShape = (shape: ThemeShape) => {
    if (pref.shape === shape) {
      const next = { ...pref };
      delete next.shape;
      setPref(next);
    } else {
      setPref({ ...pref, shape });
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <View style={[styles.header, { borderBottomColor: p.cardBorder }]}>
        <TouchableOpacity onPress={onBack} hitSlop={10} style={styles.backBtn}>
          <Text style={[styles.backText, { color: p.accent }]}>{'‹ ' + COPY.backLabel}</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: p.text }]}>{COPY.settingsTitle}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.sectionTitle, { color: p.textMuted }]}>{COPY.themeSectionTitle}</Text>
        <View style={styles.presetGrid}>
          {Object.keys(PRESETS).map((id) => {
            const preset = PRESETS[id];
            const selected = pref.preset === id;
            const ringColor = selected ? p.accent : p.cardBorder;
            const ringWidth = selected ? 2 : 1;
            return (
              <TouchableOpacity
                key={id}
                onPress={() => selectPreset(id)}
                style={[styles.presetCard, { backgroundColor: p.card, borderColor: ringColor, borderWidth: ringWidth }]}
              >
                <Text style={[styles.presetName, { color: p.text }]}>{presetLabel(id)}</Text>
                <View style={styles.dotRow}>
                  <View style={[styles.dot, { backgroundColor: preset.colors.bg, borderColor: p.cardBorder }]} />
                  <View style={[styles.dot, { backgroundColor: preset.colors.surface, borderColor: p.cardBorder }]} />
                  <View style={[styles.dot, { backgroundColor: preset.colors.primary, borderColor: p.cardBorder }]} />
                  <View style={[styles.dot, { backgroundColor: preset.colors.text, borderColor: p.cardBorder }]} />
                </View>
                <Text style={[styles.presetHint, { color: p.textMuted }]}>
                  {preset.dark ? COPY.themeDarkHint : COPY.themeLightHint}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.sectionTitle, { color: p.textMuted }]}>{COPY.accentSectionTitle}</Text>
        <View style={styles.accentRow}>
          <TouchableOpacity
            onPress={clearAccent}
            accessibilityLabel={COPY.accentDefaultLabel}
            style={[styles.swatch, { backgroundColor: PRESETS[theme.name].colors.primary, borderColor: defaultRingColor, borderWidth: defaultRingWidth }]}
          />
          {Object.keys(ACCENTS).map((id) => {
            const selected = pref.accent === id;
            const ringColor = selected ? p.text : TRANSPARENT;
            const ringWidth = selected ? 2 : 0;
            return (
              <TouchableOpacity
                key={id}
                onPress={() => selectAccent(id)}
                accessibilityLabel={accentLabel(id)}
                style={[styles.swatch, { backgroundColor: ACCENTS[id].primary, borderColor: ringColor, borderWidth: ringWidth }]}
              />
            );
          })}
        </View>

        <Text style={[styles.sectionTitle, { color: p.textMuted }]}>{COPY.cornersSectionTitle}</Text>
        <View style={styles.segmentRow}>
          {SHAPES.map((shape) => {
            const selected = theme.shape === shape;
            return (
              <TouchableOpacity
                key={shape}
                onPress={() => toggleShape(shape)}
                style={[styles.segment, { backgroundColor: selected ? p.accent : p.card, borderColor: p.cardBorder }]}
              >
                <Text style={[styles.segmentText, { color: selected ? p.onAccent : p.text }]}>{SHAPE_LABEL[shape]}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { paddingVertical: 2 },
  backText: { fontSize: 15, fontWeight: '700' },
  title: { fontSize: 18, fontWeight: '800' },
  content: { padding: 16, paddingBottom: 40 },
  sectionTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 20, marginBottom: 10 },
  presetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  presetCard: { width: '47%', borderRadius: 14, padding: 12 },
  presetName: { fontSize: 14, fontWeight: '700' },
  dotRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1 },
  presetHint: { fontSize: 11, marginTop: 8 },
  accentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  swatch: { width: 34, height: 34, borderRadius: 17 },
  segmentRow: { flexDirection: 'row', gap: 8 },
  segment: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10, borderWidth: 1 },
  segmentText: { fontSize: 13, fontWeight: '700' },
});
