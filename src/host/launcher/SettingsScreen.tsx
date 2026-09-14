// ─────────────────────────────────────────────────────────────────────────────
// SettingsScreen — the launcher's one settings surface (v2; docs/design/README.md "Two systems,
// not one" — the theme preset/accent/corners picker is CUT, the shell is fixed and
// non-themeable).
// ─────────────────────────────────────────────────────────────────────────────
// Colors come only from `SHELL_PALETTE` (the shell's one fixed palette — never a hex
// literal of its own) and type faces from the SDK's v2 `TYPE_SCALE`/`RADIUS` (`vc-sdk`'s theme
// module). This screen is not a mini-app host: it owns its own hardware-back binding directly,
// and never touches `BackPolicy` (which only ever binds inside `useMiniAppHost`).
import React, { useEffect, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { RADIUS, STATUS_COLORS, TYPE_SCALE } from '../../sdk/theme';
import { COPY, serverProbeLabel } from './copy';
import { sanitizeServerUrl } from './server-address';
import type { ProbeResult } from './server-probe';
import { probeServer } from './server-probe';
import { DebouncedProbe } from './settings-probe';
import type { SettingsProbeState } from './settings-probe';
import { SHELL_PALETTE } from './theme';

export interface SettingsScreenProps {
  /** Returns to the home screen — supplied by `LauncherRoot`. */
  onBack: () => void;
  /** The persisted generation-server address (design D3), or `undefined` when unset. */
  serverUrl?: string;
  /** Persists the entered address — `LauncherRoot` writes it via `saveServerUrl` and re-reads
   *  the sanitized result back into its own state, same round-trip `server-address.ts` uses. */
  onServerUrlChange: (url: string) => void;
  /** Whether Whim Syntax prose highlighting is on (default true; `highlighting.ts`). */
  highlighting: boolean;
  /** Persists the toggle — `LauncherRoot` writes it via `saveHighlighting`. */
  onHighlightingChange: (enabled: boolean) => void;
}

/** The save-time probe result's colour (design.md decision 1's three-way classification), drawn
 *  from the same status hues the rest of the launcher uses for state (`STATUS_COLORS`) plus
 *  `SHELL_PALETTE.danger` (passed in as a plain string — `SettingsScreen` is the one caller, so
 *  this takes no palette-typed parameter of its own) — no hex literal of this screen's own.
 *  `verified` reads as done (teal), `unreachable` as the shell's danger red, `unverified` as the
 *  reserved muted grey — the only third distinct hue this token set offers. */
function probeResultColor(result: ProbeResult, dangerColor: string): string {
  if (result === 'verified') return STATUS_COLORS.done;
  if (result === 'unreachable') return dangerColor;
  return STATUS_COLORS.waiting;
}

export default function SettingsScreen({
  onBack,
  serverUrl,
  onServerUrlChange,
  highlighting,
  onHighlightingChange,
}: Readonly<SettingsScreenProps>) {
  const [serverUrlDraft, setServerUrlDraft] = useState(serverUrl ?? '');
  const [probeState, setProbeState] = useState<SettingsProbeState>('idle');
  const p = SHELL_PALETTE;

  // The debounced probe (design.md decision 3) is created once and lives for the screen's own
  // lifetime — `publish` is a stable `setState` dispatch, `probe` a stable module import, so no
  // dependency ever changes under it.
  const [debouncedProbe] = useState(
    () => new DebouncedProbe({ probe: (url) => probeServer(url), publish: setProbeState }),
  );

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  // Cancels any pending debounce timer / in-flight probe on unmount — the screen's own lifetime
  // is the probe's scope (design.md decision 3: "SettingsScreen owns this local debounce/probe-
  // state ... the result never needs to outlive the screen").
  useEffect(() => () => debouncedProbe.cancel(), [debouncedProbe]);

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <View style={[styles.header, { borderBottomColor: p.cardBorder }]}>
        <TouchableOpacity
          onPress={onBack}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={COPY.backLabel}
          style={[styles.backBtn, { backgroundColor: p.card, borderColor: p.cardBorder }]}
        >
          <View style={[styles.backChevron, { borderColor: p.text }]} />
        </TouchableOpacity>
        {/* `stepTitle` (26/29.9/-0.65/700), NOT `screenTitle`: ruling R12. `screenTitle` was
            retargeted 26 -> 22 on the strength of the history/confirm-sheet mockups, and this
            screen has no mockup and no design basis for shrinking. `stepTitle` holds the numbers
            `screenTitle` used to, so this renders exactly as it does today. */}
        <Text style={[TYPE_SCALE.stepTitle, { color: p.text }]}>{COPY.settingsTitle}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[TYPE_SCALE.eyebrow, styles.sectionTitle, { color: p.textMuted }]}>
          {COPY.serverAddressSectionTitle}
        </Text>
        <TextInput
          value={serverUrlDraft}
          onChangeText={(next) => {
            // Save is unchanged: immediate and unconditional, regardless of the probe below.
            setServerUrlDraft(next);
            onServerUrlChange(next);
            // Only the informational probe is debounced (design.md decision 3) — the same
            // normalization `saveServerUrl` applies before persisting, so the probe never trips
            // over a trailing slash the save itself would have stripped.
            debouncedProbe.schedule(sanitizeServerUrl(next) ?? '');
          }}
          placeholder={COPY.serverAddressPlaceholder}
          placeholderTextColor={p.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={[
            TYPE_SCALE.body,
            styles.serverInput,
            { color: p.text, borderColor: p.cardBorder, backgroundColor: p.card },
          ]}
        />
        <Text style={[TYPE_SCALE.caption, styles.hint, { color: p.textMuted }]}>{COPY.serverAddressHint}</Text>
        {probeState !== 'idle' && probeState !== 'checking' ? (
          <Text style={[TYPE_SCALE.caption, styles.hint, { color: probeResultColor(probeState, p.danger) }]}>
            {serverProbeLabel(probeState)}
          </Text>
        ) : null}

        <Text style={[TYPE_SCALE.eyebrow, styles.sectionTitle, { color: p.textMuted }]}>
          {COPY.highlightingSectionTitle}
        </Text>
        <View style={[styles.row, { backgroundColor: p.card, borderColor: p.cardBorder }]}>
          <Text style={[TYPE_SCALE.body, { color: p.text }]}>{COPY.highlightingSectionTitle}</Text>
          <Switch
            value={highlighting}
            onValueChange={onHighlightingChange}
            trackColor={{ false: p.cardBorder, true: p.accent }}
            thumbColor={p.onAccent}
          />
        </View>
        <Text style={[TYPE_SCALE.caption, styles.hint, { color: p.textMuted }]}>{COPY.highlightingHint}</Text>
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
  // Design :23 — a 42x42 circular button, no text label. There is no SVG library in this app, so
  // the chevron is a 10x10 box wearing two borders, rotated 45°. RN renders square line-caps where
  // the design asks for round ones; that is an accepted, unavoidable gap, NOT something to
  // compensate for with a different stroke width.
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: RADIUS.chip,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  backChevron: {
    width: 10,
    height: 10,
    borderLeftWidth: 2.4,
    borderBottomWidth: 2.4,
    transform: [{ rotate: '45deg' }],
    marginLeft: 2,
  },
  content: { padding: 16, paddingBottom: 40 },
  sectionTitle: { marginTop: 24, marginBottom: 10 },
  serverInput: { borderWidth: 1, borderRadius: RADIUS.field, paddingHorizontal: 12, paddingVertical: 10 },
  hint: { marginTop: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: RADIUS.field,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
});
