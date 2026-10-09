/**
 * AdvancedScreen — diagnostics, this phone's ID and the server (design-system-v1 task 14.3; spec
 * app-launcher "Settings puts common settings first and diagnostics under Advanced"; spec
 * privacy-settings "Settings shows this phone's ID and can make a new one"; system.md §9 Advanced).
 * Pushed on the native stack over Settings.
 *
 * "Send error details" with its explanation as the footer; This phone: the ID every request
 * carries, truncated in the middle with a copy button, and "Make a new ID" behind a confirm sheet
 * whose safe choice keeps it; Server: "Whim's server" and "Your own server" as two choices. The
 * first use of your own server asks once (#70); after that the address field shows, and switching
 * back to Whim's server keeps the address. The field saves once typing pauses and sends nothing
 * itself: the session's own probe checks the saved address, one probe per pause (#130), and its
 * result shows under the field.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Clipboard, View } from 'react-native';
import { LAYOUT, SPACE } from '../../design/tokens';
import type { ColorRole } from '../../design/tokens';
import { ConfirmSheet } from '../ui/ConfirmSheet';
import { GroupedRow, GroupedSection } from '../ui/GroupedList';
import { Text } from '../ui/Text';
import { TextField } from '../ui/TextField';
import { useToast } from '../ui/Toast';
import { useTokens } from '../ui/tokens';
import { makeStyles } from '../ui/tokens-pure';
import { COPY, LEGAL_COPY, serverProbeLabel } from './copy';
import KeyboardShell from './KeyboardShell';
import type { LegalLanguage } from './legal-language';
import { RELEASE } from './release-config';
import { serverAddressAllowed, type ServerChoice } from './server-address';
import type { ProbeResult } from './server-probe';
import { DebouncedSave } from './settings-probe';
import { addressCheck, middleTruncated, type SessionProbe } from './settings-sections';
import { useSystemBack } from './use-system-back';

export interface AdvancedScreenProps {
  /** Back to Settings: system back, and the stack's header back through the same handler. */
  onBack: () => void;
  /** The "Send error details" switch (privacy-settings; `error-details.ts`, default on). */
  errorDetails: boolean;
  onErrorDetailsChange: (on: boolean) => void;
  /** The ID every request carries as `x-whim-device` (`device-id.ts`). */
  deviceId: string;
  /** Replaces the stored ID — called only after the confirm sheet's "Make a new ID". */
  onResetDeviceId: () => void;
  /** The chosen server row (`server-address#serverChoice`). */
  serverChoice: ServerChoice;
  /** Whether the user has confirmed, once, that their own server is their responsibility (D20). */
  ownServerAcknowledged: boolean;
  /** Records that acknowledgement and chooses "Your own server". */
  onAcknowledgeOwnServer: () => void;
  /** Chooses a server row; Whim's server keeps the saved address. */
  onChooseServer: (choice: ServerChoice) => void;
  /** The saved own-server address (`server-address#loadServerUrl`), kept while Whim's is chosen. */
  savedAddress?: string;
  /** Persists the address once typing pauses, on submit or blur, and on leaving with an unsaved
   *  edit; never with an address the rule refuses. */
  onServerUrlChange: (url: string) => void;
  /** Whether the session probes at all (server-connectivity "Without a current consent grant the
   *  system SHALL NOT probe"). */
  canProbe: boolean;
  /** The session probe's latest result and the address it checked. */
  probe: SessionProbe | null;
  /** The active legal language: the own-server confirm sheet and caption are legal text. */
  legalLanguage: LegalLanguage;
}

const PROBE_COLOR: Readonly<Record<ProbeResult, ColorRole>> = {
  verified: 'positive-text',
  unverified: 'text-2',
  unreachable: 'danger-text',
};

const styles = makeStyles((t) => ({
  root: { backgroundColor: t.colors.bg },
  content: { paddingHorizontal: LAYOUT.gutter, paddingTop: SPACE[4], paddingBottom: SPACE[8] },
  address: { marginTop: -SPACE[2], marginBottom: LAYOUT.gapBetweenGroups, gap: SPACE[2] },
}));

export default function AdvancedScreen({
  onBack,
  errorDetails,
  onErrorDetailsChange,
  deviceId,
  onResetDeviceId,
  serverChoice,
  ownServerAcknowledged,
  onAcknowledgeOwnServer,
  onChooseServer,
  savedAddress,
  onServerUrlChange,
  canProbe,
  probe,
  legalLanguage,
}: Readonly<AdvancedScreenProps>) {
  const t = useTokens();
  const s = styles(t);
  const toast = useToast();
  const legal = LEGAL_COPY[legalLanguage];
  const [draft, setDraft] = useState(savedAddress ?? '');
  // The last settled draft was refused by the address rule, so it wasn't saved.
  const [refused, setRefused] = useState(false);
  const [confirmingNewId, setConfirmingNewId] = useState(false);
  const [confirmingOwnServer, setConfirmingOwnServer] = useState(false);
  // The field with the lines under it: the block kept in view above the keyboard while typing.
  const addressBlock = useRef<View>(null);
  useSystemBack(onBack);

  // The save settles once typing pauses, through the latest `onServerUrlChange`, and only for an
  // address the rule allows: a refused one is explained under the field and dropped.
  const saveRef = useRef(onServerUrlChange);
  useEffect(() => {
    saveRef.current = onServerUrlChange;
  }, [onServerUrlChange]);
  const [addressSave] = useState(
    () =>
      new DebouncedSave({
        save: (url) => {
          const allowed = serverAddressAllowed(url);
          setRefused(!allowed);
          if (allowed) saveRef.current(url);
        },
      }),
  );
  // Leaving saves an edit still waiting on its pause.
  useEffect(() => () => addressSave.flush(), [addressSave]);

  const onAddressChange = (next: string) => {
    setDraft(next);
    setRefused(false);
    addressSave.edit(next);
  };

  const chooseWhim = () => {
    onChooseServer('whim');
    addressSave.flush();
  };
  const chooseOwn = () => {
    if (ownServerAcknowledged) onChooseServer('own');
    else setConfirmingOwnServer(true);
  };

  const copyId = () => {
    Clipboard.setString(deviceId);
    toast.show({ message: COPY.settingsDeviceIdCopied });
  };

  const check = refused ? null : addressCheck(canProbe, draft, probe);
  const own = serverChoice === 'own';
  return (
    <>
      <KeyboardShell style={s.root} contentContainerStyle={s.content}>
        <GroupedSection footer={COPY.settingsErrorDetailsHint}>
          <GroupedRow title={COPY.settingsErrorDetailsTitle} trailing={{ kind: 'switch', value: errorDetails, onValueChange: onErrorDetailsChange }} />
        </GroupedSection>

        <GroupedSection header={COPY.settingsThisPhoneSection} footer={COPY.settingsDeviceIdHint}>
          <GroupedRow
            title={COPY.settingsDeviceIdTitle}
            subtitle={middleTruncated(deviceId)}
            accessibilityHint={COPY.settingsDeviceIdHint}
            trailing={{ kind: 'copy', label: COPY.settingsDeviceIdCopy, onCopy: copyId }}
          />
          <GroupedRow title={COPY.settingsDeviceIdReset} onPress={() => setConfirmingNewId(true)} />
        </GroupedSection>

        <GroupedSection header={COPY.settingsServerSection}>
          <GroupedRow title={COPY.settingsServerWhim} trailing={{ kind: 'check', checked: !own }} onPress={chooseWhim} />
          <GroupedRow title={COPY.settingsServerOwn} trailing={own ? { kind: 'check', checked: true } : { kind: 'chevron' }} onPress={chooseOwn} />
        </GroupedSection>
        {own && (
          <View ref={addressBlock} style={s.address}>
            <TextField
              revealTarget={addressBlock}
              label={COPY.serverAddressSectionTitle}
              value={draft}
              onChangeText={onAddressChange}
              onSubmitEditing={() => addressSave.flush()}
              onBlur={() => addressSave.flush()}
              placeholder={RELEASE.serverUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              error={refused ? COPY.serverAddressRefused : undefined}
              helper={COPY.serverAddressHint}
            />
            {check !== null && (
              <Text type="footnote" color={check === 'neutral' ? 'text-2' : PROBE_COLOR[check]} accessibilityRole="text">
                {check === 'neutral' ? COPY.settingsProbeNeutral : serverProbeLabel(check)}
              </Text>
            )}
            {savedAddress !== undefined && (
              <Text type="footnote" color="text-2">
                {legal.ownServerCaption}
              </Text>
            )}
          </View>
        )}
      </KeyboardShell>
      <ConfirmSheet
        visible={confirmingNewId}
        title={COPY.settingsDeviceIdResetTitle}
        body={COPY.settingsDeviceIdResetConfirm}
        keepLabel={COPY.settingsDeviceIdKeep}
        confirmLabel={COPY.settingsDeviceIdReset}
        onKeep={() => setConfirmingNewId(false)}
        onConfirm={() => {
          setConfirmingNewId(false);
          onResetDeviceId();
        }}
      />
      <ConfirmSheet
        visible={confirmingOwnServer}
        title={legal.ownServerAction}
        body={legal.ownServerConfirmBody}
        keepLabel={COPY.ownServerKeep}
        confirmLabel={legal.ownServerConfirm}
        onKeep={() => setConfirmingOwnServer(false)}
        onConfirm={() => {
          setConfirmingOwnServer(false);
          onAcknowledgeOwnServer();
        }}
      />
    </>
  );
}
