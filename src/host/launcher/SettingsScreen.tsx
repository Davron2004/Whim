// ─────────────────────────────────────────────────────────────────────────────
// SettingsScreen — the launcher's one settings surface (v2; docs/design/README.md "Two systems,
// not one" — the theme preset/accent/corners picker is CUT, the shell is fixed and
// non-themeable).
// ─────────────────────────────────────────────────────────────────────────────
// Colors come only from `SHELL_PALETTE` (the shell's one fixed palette — never a hex
// literal of its own) and type faces from the SDK's v2 `TYPE_SCALE`/`RADIUS` (`vc-sdk`'s theme
// module). This screen is not a mini-app host: it owns its own hardware-back binding directly,
// and never touches `BackPolicy` (which only ever binds inside `useMiniAppHost`).
//
// Four sections, in order (design D7; app-launcher "Settings groups its controls into titled
// sections, with the server address under Advanced"): AI features (opens the consent screen in
// review mode, and the "Send error details" switch), Highlighting (unchanged), About (privacy
// policy, terms of use, support, this phone's ID), and — in internal builds only (legal-surface-v2
// D10) — Advanced (the server address override, collapsed unless one is saved).
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, Linking, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { RADIUS, STATUS_COLORS, TYPE_SCALE } from '../../sdk/theme';
import type { ConsentStatus } from './ai-consent';
import { aiFeaturesStatusLine, COPY, serverProbeLabel } from './copy';
import { RELEASE } from './release-config';
import { activeLegalLanguage, privacyPolicyUrl, termsUrl } from './legal-language';
import { sanitizeServerUrl } from './server-address';
import type { ProbeResult } from './server-probe';
import { probeServer } from './server-probe';
import { advancedInitiallyOpen } from './settings-sections';
import { DebouncedProbe } from './settings-probe';
import type { SettingsProbeState } from './settings-probe';
import { SHELL_PALETTE } from './theme';
import { useSystemBack } from './use-system-back';

export interface SettingsScreenProps {
  /** Returns to the home screen — supplied by `LauncherRoot`. */
  onBack: () => void;
  /** Whether this is an internal build (`installed-app-info.ts#installedInternalBuild`). A store
   *  build renders no Advanced section and no server address field at all (legal-surface-v2 D10). */
  internalBuild: boolean;
  /** The persisted generation-server address (design D3), or `undefined` when unset. */
  serverUrl?: string;
  /** Persists the entered address — `LauncherRoot` writes it via `saveServerUrl` and re-reads
   *  the sanitized result back into its own state, same round-trip `server-address.ts` uses. */
  onServerUrlChange: (url: string) => void;
  /** Clears the saved override so the next request targets the compiled-in server (design D7,
   *  app-launcher "Going back to the default"). Shown only while an override is saved. */
  onUseDefaultServer: () => void;
  /** Whether Whim Syntax prose highlighting is on (default true; `highlighting.ts`). */
  highlighting: boolean;
  /** Persists the toggle — `LauncherRoot` writes it via `saveHighlighting`. */
  onHighlightingChange: (enabled: boolean) => void;
  /** The AI features row's own state (ai-data-consent "Settings shows consent and can review or
   *  turn it off") — read fresh by the caller on every render, never cached here. */
  consentStatus: ConsentStatus;
  /** Whether the save-time probe may run at all (server-connectivity "Without a current consent
   *  grant the system SHALL NOT probe" — design D2/D7): gates BOTH the probe request itself and
   *  which result line renders. */
  canProbe: boolean;
  /** Opens the consent screen in review mode. */
  onOpenAIFeatures: () => void;
  /** The "Send error details" switch (privacy-settings; `error-details.ts`, default on). */
  errorDetails: boolean;
  /** Persists the switch — `LauncherRoot` writes it via `setErrorDetails`. */
  onErrorDetailsChange: (on: boolean) => void;
  /** The ID every request carries as `x-whim-device` (`device-id.ts`). */
  deviceId: string;
  /** Replaces the stored ID — called only after the confirm step's "Make a new ID". */
  onResetDeviceId: () => void;
}

const ADVANCED_CHEVRON_DURATION_MS = 200;

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
  onUseDefaultServer,
  highlighting,
  onHighlightingChange,
  consentStatus,
  canProbe,
  onOpenAIFeatures,
  internalBuild,
  errorDetails,
  onErrorDetailsChange,
  deviceId,
  onResetDeviceId,
}: Readonly<SettingsScreenProps>) {
  const [serverUrlDraft, setServerUrlDraft] = useState(serverUrl ?? '');
  const [probeState, setProbeState] = useState<SettingsProbeState>('idle');
  const [advancedOpen, setAdvancedOpen] = useState(() => advancedInitiallyOpen(serverUrl));
  const p = SHELL_PALETTE;

  // The Advanced disclosure chevron rotates smoothly between closed (right) and open (down)
  // rather than snapping — bare `Easing.ease` is CSS ease-IN (accelerates); `Easing.inOut(Easing.
  // ease)` eases both ends instead, so the rotation settles rather than flicking.
  const chevronAnim = useRef(new Animated.Value(advancedOpen ? 1 : 0)).current;
  useEffect(() => {
    const anim = Animated.timing(chevronAnim, {
      toValue: advancedOpen ? 1 : 0,
      duration: ADVANCED_CHEVRON_DURATION_MS,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [advancedOpen, chevronAnim]);
  const chevronRotate = chevronAnim.interpolate({ inputRange: [0, 1], outputRange: ['-45deg', '45deg'] });

  // The debounced probe (design.md decision 3) is created once and lives for the screen's own
  // lifetime — `publish` is a stable `setState` dispatch, `probe` a stable module import, so no
  // dependency ever changes under it.
  const [debouncedProbe] = useState(
    () => new DebouncedProbe({ probe: (url) => probeServer(url), publish: setProbeState }),
  );

  useSystemBack(onBack);

  // Cancels any pending debounce timer / in-flight probe on unmount — the screen's own lifetime
  // is the probe's scope (design.md decision 3: "SettingsScreen owns this local debounce/probe-
  // state ... the result never needs to outlive the screen").
  useEffect(() => () => debouncedProbe.cancel(), [debouncedProbe]);

  const onUseDefault = () => {
    setServerUrlDraft('');
    debouncedProbe.cancel();
    setProbeState('idle');
    onUseDefaultServer();
  };

  // The confirm step before replacing the ID (privacy-settings "Settings shows this phone's ID and
  // can make a new one"): Cancel changes nothing.
  const confirmResetDeviceId = () => {
    Alert.alert(COPY.settingsDeviceIdReset, COPY.settingsDeviceIdResetConfirm, [
      { text: COPY.cancel, style: 'cancel' },
      { text: COPY.settingsDeviceIdReset, onPress: onResetDeviceId },
    ]);
  };

  const aiFeaturesSubtitle =
    consentStatus.kind === 'granted'
      ? aiFeaturesStatusLine('granted', new Date(consentStatus.grantedAt).toLocaleDateString())
      : aiFeaturesStatusLine(consentStatus.kind);

  // The save-time probe's inline result (design.md decision 3): the neutral line while AI
  // features are off (server-connectivity "Without a current consent grant the system SHALL NOT
  // probe"), the settled classification once AI features are on and the probe has resolved, or
  // nothing while a probe is still in flight / the field is untouched.
  let probeLine: string | null = null;
  let probeLineColor = p.textMuted;
  if (!canProbe) {
    probeLine = COPY.settingsProbeNeutral;
  } else if (probeState !== 'idle' && probeState !== 'checking') {
    probeLine = serverProbeLabel(probeState);
    probeLineColor = probeResultColor(probeState, p.danger);
  }

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
        {/* AI features (ai-data-consent "Settings shows consent and can review or turn it off") */}
        <Text style={[TYPE_SCALE.eyebrow, styles.sectionTitle, { color: p.textMuted }]}>
          {COPY.settingsAISectionTitle}
        </Text>
        <TouchableOpacity
          onPress={onOpenAIFeatures}
          accessibilityRole="button"
          style={[styles.row, { backgroundColor: p.card, borderColor: p.cardBorder }]}
        >
          <Text style={[TYPE_SCALE.body, { color: p.text }]}>{COPY.settingsAISectionTitle}</Text>
          <Text style={[TYPE_SCALE.caption, { color: p.textMuted }]}>{aiFeaturesSubtitle}</Text>
        </TouchableOpacity>
        <View style={[styles.row, styles.rowFollowing, { backgroundColor: p.card, borderColor: p.cardBorder }]}>
          <Text style={[TYPE_SCALE.body, { color: p.text }]}>{COPY.settingsErrorDetailsTitle}</Text>
          <Switch
            value={errorDetails}
            onValueChange={onErrorDetailsChange}
            accessibilityLabel={COPY.settingsErrorDetailsTitle}
            trackColor={{ false: p.cardBorder, true: p.accent }}
            thumbColor={p.onAccent}
          />
        </View>
        <Text style={[TYPE_SCALE.caption, styles.hint, { color: p.textMuted }]}>{COPY.settingsErrorDetailsHint}</Text>

        {/* Highlighting (unchanged) */}
        <Text style={[TYPE_SCALE.eyebrow, styles.sectionTitle, { color: p.textMuted }]}>
          {COPY.highlightingSectionTitle}
        </Text>
        <View style={[styles.row, { backgroundColor: p.card, borderColor: p.cardBorder }]}>
          <Text style={[TYPE_SCALE.body, { color: p.text }]}>{COPY.highlightingSectionTitle}</Text>
          <Switch
            value={highlighting}
            onValueChange={onHighlightingChange}
            accessibilityLabel={COPY.highlightingSectionTitle}
            trackColor={{ false: p.cardBorder, true: p.accent }}
            thumbColor={p.onAccent}
          />
        </View>
        <Text style={[TYPE_SCALE.caption, styles.hint, { color: p.textMuted }]}>{COPY.highlightingHint}</Text>

        {/* About */}
        <Text style={[TYPE_SCALE.eyebrow, styles.sectionTitle, { color: p.textMuted }]}>
          {COPY.settingsAboutSectionTitle}
        </Text>
        <TouchableOpacity
          onPress={() => Linking.openURL(privacyPolicyUrl(activeLegalLanguage()))}
          accessibilityRole="button"
          style={[styles.row, styles.rowStacked, { backgroundColor: p.card, borderColor: p.cardBorder }]}
        >
          <Text style={[TYPE_SCALE.body, { color: p.text }]}>{COPY.privacyPolicyLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => Linking.openURL(termsUrl(activeLegalLanguage()))}
          accessibilityRole="button"
          style={[styles.row, styles.rowStacked, { backgroundColor: p.card, borderColor: p.cardBorder }]}
        >
          <Text style={[TYPE_SCALE.body, { color: p.text }]}>{COPY.termsOfUseLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => Linking.openURL(RELEASE.supportUrl)}
          accessibilityRole="button"
          style={[styles.row, styles.rowStacked, { backgroundColor: p.card, borderColor: p.cardBorder }]}
        >
          <Text style={[TYPE_SCALE.body, { color: p.text }]}>{COPY.supportLabel}</Text>
        </TouchableOpacity>
        <View style={[styles.idCard, { backgroundColor: p.card, borderColor: p.cardBorder }]}>
          <Text style={[TYPE_SCALE.body, { color: p.text }]}>{COPY.settingsDeviceIdTitle}</Text>
          <Text selectable style={[TYPE_SCALE.caption, { color: p.text }]}>
            {deviceId}
          </Text>
        </View>
        <Text style={[TYPE_SCALE.caption, styles.hint, { color: p.textMuted }]}>{COPY.settingsDeviceIdHint}</Text>
        <TouchableOpacity onPress={confirmResetDeviceId} hitSlop={10} accessibilityRole="button">
          <Text style={[TYPE_SCALE.bodyEmphatic, styles.textAction, { color: p.accent }]}>
            {COPY.settingsDeviceIdReset}
          </Text>
        </TouchableOpacity>

        {/* Advanced (app-launcher "Settings groups its controls...with the server address under
            Advanced") — internal builds only; one row that expands inline; already open while an
            override is saved. */}
        {internalBuild && (
          <TouchableOpacity
            onPress={() => setAdvancedOpen((open) => !open)}
            accessibilityRole="button"
            style={styles.advancedHeader}
          >
            <Text style={[TYPE_SCALE.eyebrow, { color: p.textMuted }]}>{COPY.settingsAdvancedSectionTitle}</Text>
            <Animated.View
              style={[
                styles.advancedChevron,
                { borderColor: p.textMuted, transform: [{ rotate: chevronRotate }] },
              ]}
            />
          </TouchableOpacity>
        )}

        {internalBuild && advancedOpen && (
          <>
            <Text style={[TYPE_SCALE.eyebrow, styles.sectionTitle, { color: p.textMuted }]}>
              {COPY.serverAddressSectionTitle}
            </Text>
            <TextInput
              value={serverUrlDraft}
              onChangeText={(next) => {
                // Save is unchanged: immediate and unconditional, regardless of the probe below.
                setServerUrlDraft(next);
                onServerUrlChange(next);
                // The informational probe is BOTH debounced (design.md decision 3) AND gated on
                // consent (server-connectivity "Without a current consent grant the system SHALL
                // NOT probe" — design D2/D7) — the same normalization `saveServerUrl` applies
                // before persisting, so the probe never trips over a trailing slash the save
                // itself would have stripped.
                if (canProbe) {
                  debouncedProbe.schedule(sanitizeServerUrl(next) ?? '');
                }
              }}
              placeholder={RELEASE.serverUrl.replace(/^https?:\/\//, '')}
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
            {probeLine != null && (
              <Text style={[TYPE_SCALE.caption, styles.hint, { color: probeLineColor }]}>{probeLine}</Text>
            )}
            {serverUrlDraft.trim().length > 0 && (
              <TouchableOpacity onPress={onUseDefault} hitSlop={10}>
                <Text style={[TYPE_SCALE.bodyEmphatic, styles.textAction, { color: p.accent }]}>
                  {COPY.settingsUseDefaultServer}
                </Text>
              </TouchableOpacity>
            )}
          </>
        )}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: RADIUS.field,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowStacked: { marginBottom: 10 },
  rowFollowing: { marginTop: 10 },
  idCard: { borderRadius: RADIUS.field, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 14, gap: 4 },
  advancedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24,
    paddingVertical: 10,
  },
  // A box with its right+bottom borders visible draws a corner whose bisector points down-right
  // (45deg); `chevronRotate` (-45deg closed / 45deg open) turns that corner to point right when
  // collapsed and down when expanded, per `chevronAnim` above.
  advancedChevron: { width: 8, height: 8, borderRightWidth: 2, borderBottomWidth: 2 },
  serverInput: { borderWidth: 1, borderRadius: RADIUS.field, paddingHorizontal: 12, paddingVertical: 10 },
  hint: { marginTop: 6 },
  textAction: { marginTop: 10 },
});
