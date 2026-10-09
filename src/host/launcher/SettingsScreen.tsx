// ─────────────────────────────────────────────────────────────────────────────
// SettingsScreen — the launcher's one settings surface (v2; the v2 handoff README (removed by decision #75; in git history) "Two systems,
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
// policy, terms of use, support, this phone's ID), and Advanced (the user's own server, behind a
// once-per-install acknowledgement — beta-1 D20 — collapsed unless an override is saved).
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Linking, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import type { ScrollView } from 'react-native';
import { RADIUS, SPACING, STATUS_COLORS, TYPE_SCALE } from '../../sdk/theme';
import type { ConsentStatus } from './ai-consent';
import { aiFeaturesStatusLine, COPY, LEGAL_COPY, serverProbeLabel } from './copy';
import { RELEASE } from './release-config';
import ConfirmSheet from './ConfirmSheet';
import { BackHeader, FLOW_HEADER_GAP } from './flow-chrome';
import KeyboardShell, { KeyboardTextInput } from './KeyboardShell';
import { legalDateLabel, privacyPolicyUrl, termsUrl, type LegalLanguage } from './legal-language';
import { sanitizeServerUrl, serverAddressAllowed } from './server-address';
import type { ProbeResult } from './server-probe';
import { probeServer } from './server-probe';
import { advancedInitiallyOpen } from './settings-sections';
import { DebouncedProbe, DebouncedSave } from './settings-probe';
import type { SettingsProbeState } from './settings-probe';
import { SHELL_PALETTE } from './theme';
import { useSystemBack } from './use-system-back';

export interface SettingsScreenProps {
  /** Returns to the home screen — supplied by `LauncherRoot`. */
  onBack: () => void;
  /** The active legal language: the About section's privacy and terms links open its pages. */
  legalLanguage: LegalLanguage;
  /** The phone's preferred locale, which writes the AI features row's date in English; without
   *  one, `Intl`'s default. */
  deviceLocale?: string;
  /** Whether the user has confirmed that their own server is their responsibility (design D20).
   *  Until then Advanced holds only "Use your own server", and no address field. */
  ownServerAcknowledged: boolean;
  /** Records the acknowledgement after the confirm step; returns the saved address it now
   *  honours, if any, for the field to show. */
  onAcknowledgeOwnServer: () => string | undefined;
  /** The override requests follow (`server-address.ts#serverOverride`), or `undefined` for none. */
  serverUrl?: string;
  /** Persists the entered address — `LauncherRoot` writes it via `saveServerUrl` and re-reads
   *  the sanitized result back into its own state, same round-trip `server-address.ts` uses.
   *  Called once typing pauses, on submit or blur, and on leaving with an unsaved edit; never with
   *  an address the address rule refuses. */
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
  ownServerAcknowledged,
  onAcknowledgeOwnServer,
  errorDetails,
  onErrorDetailsChange,
  deviceId,
  onResetDeviceId,
  legalLanguage,
  deviceLocale,
}: Readonly<SettingsScreenProps>) {
  const [serverUrlDraft, setServerUrlDraft] = useState(serverUrl ?? '');
  const [probeState, setProbeState] = useState<SettingsProbeState>('idle');
  const [advancedOpen, setAdvancedOpen] = useState(() => advancedInitiallyOpen(serverUrl));
  const [confirmingNewId, setConfirmingNewId] = useState(false);
  const [confirmingOwnServer, setConfirmingOwnServer] = useState(false);
  // The last settled draft was refused by the address rule, so it wasn't saved.
  const [addressRefused, setAddressRefused] = useState(false);
  const p = SHELL_PALETTE;
  const legal = LEGAL_COPY[legalLanguage];

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

  // The save settles once typing pauses (`DebouncedSave`), through the latest `onServerUrlChange`,
  // and only for an address the rule allows: a refused one is explained inline and dropped.
  const saveRef = useRef(onServerUrlChange);
  useEffect(() => {
    saveRef.current = onServerUrlChange;
  }, [onServerUrlChange]);
  const [addressSave] = useState(
    () =>
      new DebouncedSave({
        save: (url) => {
          const allowed = serverAddressAllowed(url);
          setAddressRefused(!allowed);
          if (allowed) saveRef.current(url);
        },
      }),
  );

  useSystemBack(onBack);

  // Leaving saves an edit still waiting on its pause, and cancels any pending debounce timer /
  // in-flight probe — the screen's own lifetime is the probe's scope (design.md decision 3:
  // "SettingsScreen owns this local debounce/probe-state ... the result never needs to outlive
  // the screen").
  useEffect(
    () => () => {
      addressSave.flush();
      debouncedProbe.cancel();
    },
    [addressSave, debouncedProbe],
  );

  const onAddressChange = (next: string) => {
    setServerUrlDraft(next);
    setAddressRefused(false);
    addressSave.edit(next);
    // The informational probe is BOTH debounced (design.md decision 3) AND gated on consent
    // (server-connectivity "Without a current consent grant the system SHALL NOT probe" — design
    // D2/D7) — the same normalization `saveServerUrl` applies before persisting, so the probe never
    // trips over a trailing slash the save itself would have stripped. An address the rule refuses
    // is never probed: the launcher sends nothing to it.
    const sanitized = sanitizeServerUrl(next) ?? '';
    if (canProbe) debouncedProbe.schedule(serverAddressAllowed(sanitized) ? sanitized : '');
  };

  // Submitting or leaving the field settles both now instead of at the end of the pause.
  const settleAddress = () => {
    addressSave.flush();
    debouncedProbe.flush();
  };

  const onUseDefault = () => {
    setServerUrlDraft('');
    setAddressRefused(false);
    addressSave.cancel();
    debouncedProbe.cancel();
    setProbeState('idle');
    onUseDefaultServer();
  };

  // Expanding Advanced reveals the address field: it is the last section, so once the content has
  // grown by it the scroll view scrolls to its end.
  const scrollRef = useRef<ScrollView>(null);
  // The address field with the lines under it, which the shell keeps in view while it is focused.
  const addressBlock = useRef<View>(null);
  const revealAdvanced = useRef(false);
  const toggleAdvanced = () => {
    revealAdvanced.current = !advancedOpen;
    setAdvancedOpen(!advancedOpen);
  };
  const onContentSizeChange = () => {
    if (!revealAdvanced.current) return;
    revealAdvanced.current = false;
    scrollRef.current?.scrollToEnd({ animated: true });
  };

  // The confirm step before the user's own server is honoured (design D20): Cancel leaves no
  // field; confirming records the acknowledgement and shows the field, with any saved address.
  const acknowledgeOwnServer = () => {
    setConfirmingOwnServer(false);
    setServerUrlDraft(onAcknowledgeOwnServer() ?? '');
    revealAdvanced.current = true;
  };

  // The confirm step before replacing the ID (privacy-settings "Settings shows this phone's ID and
  // can make a new one"), in the launcher's own confirm sheet: Cancel changes nothing.
  const makeNewId = () => {
    setConfirmingNewId(false);
    onResetDeviceId();
  };

  const aiFeaturesSubtitle =
    consentStatus.kind === 'granted'
      ? aiFeaturesStatusLine('granted', legalDateLabel(consentStatus.grantedAt, legalLanguage, deviceLocale))
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
    <KeyboardShell
      style={{ backgroundColor: p.bg }}
      contentContainerStyle={styles.content}
      scrollRef={scrollRef}
      onContentSizeChange={onContentSizeChange}
      header={<BackHeader onBack={onBack} />}
    >
      {/* `stepTitle` (26/29.9/-0.65/700), NOT `screenTitle`: ruling R12. `screenTitle` was
          retargeted 26 -> 22 on the strength of the history/confirm-sheet mockups, and this
          screen has no mockup and no design basis for shrinking. `stepTitle` holds the numbers
          `screenTitle` used to. It heads the content under the flow screens' back link, as the
          plan step's title does. */}
      <Text style={[TYPE_SCALE.stepTitle, { color: p.text }]}>{COPY.settingsTitle}</Text>
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
        onPress={() => Linking.openURL(privacyPolicyUrl(legalLanguage))}
        accessibilityRole="button"
        style={[styles.row, styles.rowStacked, { backgroundColor: p.card, borderColor: p.cardBorder }]}
      >
        <Text style={[TYPE_SCALE.body, { color: p.text }]}>{COPY.privacyPolicyLabel}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => Linking.openURL(termsUrl(legalLanguage))}
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
      <TouchableOpacity onPress={() => setConfirmingNewId(true)} hitSlop={10} accessibilityRole="button">
        <Text style={[TYPE_SCALE.bodyEmphatic, styles.textAction, { color: p.accent }]}>
          {COPY.settingsDeviceIdReset}
        </Text>
      </TouchableOpacity>
      <ConfirmSheet
        confirm={confirmingNewId ? { title: COPY.settingsDeviceIdReset, body: COPY.settingsDeviceIdResetConfirm, confirmLabel: COPY.settingsDeviceIdReset } : null}
        onCancel={() => setConfirmingNewId(false)}
        onConfirm={makeNewId}
      />

      {/* Advanced (app-launcher "Settings groups its controls...with the server address under
          Advanced") — one row that expands inline; already open while an override is saved. */}
      <TouchableOpacity
        onPress={toggleAdvanced}
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

      {/* The user's own server, behind its confirm step (design D20). */}
      {advancedOpen && !ownServerAcknowledged && (
        <TouchableOpacity
          onPress={() => setConfirmingOwnServer(true)}
          accessibilityRole="button"
          style={[styles.row, styles.rowStacked, { backgroundColor: p.card, borderColor: p.cardBorder }]}
        >
          <Text style={[TYPE_SCALE.body, { color: p.text }]}>{legal.ownServerAction}</Text>
        </TouchableOpacity>
      )}
      <ConfirmSheet
        confirm={confirmingOwnServer ? { title: legal.ownServerAction, body: legal.ownServerConfirmBody, confirmLabel: legal.ownServerConfirm } : null}
        onCancel={() => setConfirmingOwnServer(false)}
        onConfirm={acknowledgeOwnServer}
      />

      {advancedOpen && ownServerAcknowledged && (
        <>
          <Text style={[TYPE_SCALE.eyebrow, styles.sectionTitle, { color: p.textMuted }]}>
            {COPY.serverAddressSectionTitle}
          </Text>
          <View ref={addressBlock}>
            <KeyboardTextInput
              revealTarget={addressBlock}
              value={serverUrlDraft}
              onChangeText={onAddressChange}
              onSubmitEditing={settleAddress}
              onBlur={settleAddress}
              placeholder={RELEASE.serverUrl}
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
            {addressRefused && (
              <Text style={[TYPE_SCALE.caption, styles.hint, { color: p.danger }]}>{COPY.serverAddressRefused}</Text>
            )}
            {!addressRefused && probeLine != null && (
              <Text style={[TYPE_SCALE.caption, styles.hint, { color: probeLineColor }]}>{probeLine}</Text>
            )}
            {serverUrl != null && (
              <Text style={[TYPE_SCALE.caption, styles.hint, { color: p.textMuted }]}>{legal.ownServerCaption}</Text>
            )}
            {/* Inside the block the field keeps in view, so the way back to Whim's server shows
                above the keyboard too. */}
            {serverUrlDraft.trim().length > 0 && (
              <TouchableOpacity onPress={onUseDefault} hitSlop={10}>
                <Text style={[TYPE_SCALE.bodyEmphatic, styles.textAction, { color: p.accent }]}>
                  {COPY.settingsUseDefaultServer}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      )}
    </KeyboardShell>
  );
}

const styles = StyleSheet.create({
  // The flow screens' margins and title gap (`PlanStep.tsx`'s content: 26 above the title, in the
  // design, less what the shared header holds).
  content: { paddingHorizontal: SPACING.lg, paddingTop: 26 - FLOW_HEADER_GAP, paddingBottom: 40 },
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
