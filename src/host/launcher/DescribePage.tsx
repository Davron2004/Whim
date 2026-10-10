/**
 * DescribePage — the making sheet's first page (system.md §9 Describe; `prompt-flow` "Describe opens
 * with the keyboard"): "What should it do?" in `title1`, a 17 pt area focused with the keyboard up,
 * a helper line, and Continue (`ember`) riding the keyboard. Three idea chips show while the field
 * is empty and the keyboard is down. Change mode puts the app's 24 pt tile and "Changing <name>"
 * over "What should change?".
 *
 * Two rules this page exists to hold: the field is NEVER live-highlighted (Whim Syntax rule 6 — a
 * prompt is marked up only after submission, so nothing here renders through `WhimProse`), and an
 * idea chip FILLS the field without advancing the flow. Purely presentational: the clarify request
 * lives in `LauncherRoot`.
 */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { KeyboardEvents } from 'react-native-keyboard-controller';
import { LAYOUT, SPACE } from '../../design/tokens';
import { TilePlate } from '../ui/AppTile';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Notice } from '../ui/Notice';
import { Text } from '../ui/Text';
import { TextArea } from '../ui/TextField';
import { useTokens } from '../ui/tokens';
import { makeStyles } from '../ui/tokens-pure';
import type { InstalledApp } from './app-index';
import { COPY, composeHeadline, composePlaceholder, editingEyebrow } from './copy';
import { FlowNoticeBlock } from './FlowNoticeBlock';
import KeyboardShell from './KeyboardShell';
import { PageHead } from './MakingSheet';
import type { FlowNotice } from './prompt-flow';
import { useRetryGate } from './ServiceNotice';
import { tileOf } from './tile-identity';
import { useSystemBack } from './use-system-back';

/** The three idea chips, verbatim from the copy table. */
const IDEAS: readonly string[] = [COPY.homeIdeaTimer, COPY.homeIdeaTracker, COPY.homeIdeaDice];

export interface DescribePageProps {
  text: string;
  /** The app being changed (change mode): its tile and name head the page. */
  editing?: InstalledApp;
  /** The effective server's last probe/retry failed. Advisory only — never gates the field or
   *  Continue (`prompt-flow` "The compose entry point shows a server-unreachable notice without
   *  blocking generation"). */
  serverUnreachable?: boolean;
  /** A service refusal that landed here (design D9/D12); clearing (or not) as the person retypes
   *  is the caller's job (`prompt-flow.ts#describeTextChanged`). */
  notice?: FlowNotice;
  onChangeText: (text: string) => void;
  /** Sends the clarify request and opens the plan page. */
  onContinue: () => void;
  /** Android back: closes the sheet and keeps the draft, the same as the close control. */
  onClose: () => void;
}

const styles = makeStyles(() => ({
  content: { paddingHorizontal: LAYOUT.gutter, paddingBottom: SPACE[4], gap: SPACE[4] },
  changing: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACE[2] },
  chips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: SPACE[2] },
  footer: { paddingHorizontal: LAYOUT.gutter, paddingTop: LAYOUT.actionAreaTop, paddingBottom: LAYOUT.actionAreaBottom, gap: SPACE[3] },
}));

/** Whether the keyboard is up, from the keyboard library's own settled events. */
function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const subscriptions = [
      KeyboardEvents.addListener('keyboardDidShow', () => setShown(true)),
      KeyboardEvents.addListener('keyboardDidHide', () => setShown(false)),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, []);
  return shown;
}

export function DescribePage({ text, editing, serverUnreachable, notice, onChangeText, onContinue, onClose }: Readonly<DescribePageProps>) {
  const t = useTokens();
  const s = styles(t);
  const gated = useRetryGate(notice?.retryAt);
  const keyboardShown = useKeyboardShown();
  useSystemBack(onClose);
  const changing = editing !== undefined;
  const headline = composeHeadline(changing);
  const tile = editing ? tileOf(editing) : null;
  return (
    <KeyboardShell
      host="sheet"
      contentContainerStyle={s.content}
      header={<PageHead />}
      footer={
        <View style={s.footer}>
          {notice ? <FlowNoticeBlock notice={notice} /> : null}
          <Button label={COPY.flowContinue} variant="ember" disabled={text.trim().length === 0 || gated} onPress={onContinue} />
        </View>
      }
    >
      {editing && tile ? (
        <View style={s.changing}>
          <TilePlate size="inline" state="ready" tint={tile.tint} glyph={tile.icon} />
          <Text type="callout" color="text-2">
            {editingEyebrow(editing.name)}
          </Text>
        </View>
      ) : null}
      <Text type="title1">{headline}</Text>
      {serverUnreachable ? <Notice message={COPY.promptServerUnreachable} /> : null}
      <TextArea
        value={text}
        onChangeText={onChangeText}
        placeholder={composePlaceholder(changing)}
        accessibilityLabel={headline}
        helper={COPY.composeHelper}
        autoFocus
      />
      {!changing && text === '' && !keyboardShown ? (
        <View style={s.chips}>
          {IDEAS.map((idea) => (
            <Chip key={idea} kind="suggestion" label={idea} onPress={() => onChangeText(idea)} />
          ))}
        </View>
      ) : null}
    </KeyboardShell>
  );
}
