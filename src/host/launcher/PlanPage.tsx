/**
 * PlanPage — the making sheet's second page and the approval gate before making (system.md §9 Plan
 * and Can't make as asked; `prompt-flow` "The plan page shows the questions and the plan together",
 * "The plan page is the approval gate before making"). Nothing is made until `Make it` is taken.
 *
 * "Here's the plan", the person's words quoted as the hero, then "A few choices" (the clarify
 * questions, at most three, as soon as they land; "Decide for me" selected on each) and "What I'll
 * make" (the plan rows, skeleton rows until they land). Tapping a row edits it IN PLACE, one at a
 * time, with Save and Cancel at full targets (`prompt-flow.ts#updatePlanRow`); a row the person
 * rewrote shows their words and "Edited". No SDK-specific or engineering-internal detail appears
 * here: the rows are the model's own plain words, rendered through the shared Whim Syntax renderer
 * when not being edited. Answers never appear in the rows — they travel to making as
 * `clarifications`.
 *
 * When clarify answered that the request can't be made as asked, the page is the limit state
 * instead: the reason, a card with the nearest thing that could be made, `Make that instead` and
 * `Change my idea`.
 */
import React, { useCallback, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { LAYOUT, RADII, SPACE } from '../../design/tokens';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Icon } from '../ui/Icon';
import { Notice } from '../ui/Notice';
import { useSheetBack } from '../ui/Sheet';
import { Skeleton, SkeletonBlock } from '../ui/Skeleton';
import { Text } from '../ui/Text';
import { TextArea, TextField } from '../ui/TextField';
import { useTokens } from '../ui/tokens';
import { CHIP, makeStyles, PRESS_RETENTION, typeStyle } from '../ui/tokens-pure';
import WhimProse from '../ui/whim-prose/WhimProse';
import { TilePlate } from '../ui/AppTile';
import type { InstalledApp } from './app-index';
import { COPY, editingEyebrow, planHeadline, planMakeHeader, workingPlanPhrase } from './copy';
import { FlowNoticeBlock } from './FlowNoticeBlock';
import KeyboardShell from './KeyboardShell';
import { PageHead } from './MakingSheet';
import { answerSummary, foldedAt, isAnswered, type BlockExtent } from './plan-questions';
import {
  OTHER_ANSWER_MAX_CHARS,
  planBackAction,
  showsChips,
  type AnswerChange,
  type FlowAnswer,
  type FlowPlanRow,
  type FlowQuestion,
  type PlanScreen,
} from './prompt-flow';
import { useRetryGate } from './ServiceNotice';
import { tileOf } from './tile-identity';

/** The radio or checkbox drawn at the start of an option row. */
const MARK = 24;

/** The plan row's geometry, exported so its skeleton draws the same space. */
export const PLAN_ROW = { minHeight: 72, count: 3 } as const;
/** A question's skeleton: one headline-height bar over a row of chip-height blocks. */
export const QUESTION_SKELETON = { barWidth: '58%', barHeight: 22, chipWidths: [84, 112, 72] } as const;

export interface PlanPageProps {
  screen: PlanScreen;
  /** Change mode: the app being changed heads the page with its tile and name. */
  editing?: InstalledApp;
  /** Back: return to Describe with the words and answers kept. While a row is being edited, back
   *  cancels that edit instead (`planBackAction`). Android back takes the same step (`useSheetBack`). */
  onBack: () => void;
  onAnswer: (questionId: string, change: AnswerChange) => void;
  onChangeRow: (index: number, text: string) => void;
  /** `Make it` / `Make the change`: the first moment a generation request is sent. */
  onMake: () => void;
  /** "Try again" after the page could not reach the server: sends the request it was missing. */
  onTryAgain: () => void;
  /** The limit state's `Make that instead`. */
  onMakeInstead: () => void;
}

const styles = makeStyles((t) => ({
  content: { paddingHorizontal: LAYOUT.gutter, paddingBottom: SPACE[4], gap: SPACE[4] },
  changing: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACE[2] },
  footer: { paddingHorizontal: LAYOUT.gutter, paddingTop: LAYOUT.actionAreaTop, paddingBottom: LAYOUT.actionAreaBottom, gap: SPACE[3] },
  section: { gap: SPACE[3] },
  question: { gap: SPACE[2] },
  chips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: SPACE[2] },
  group: { backgroundColor: t.colors['sheet-group'], borderRadius: RADII.lg.radius, borderCurve: 'continuous' as const, overflow: 'hidden' as const },
  separator: { height: 1, backgroundColor: t.colors.separator, marginLeft: LAYOUT.separatorInset },
  option: {
    minHeight: LAYOUT.listRowMinHeight,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACE[3],
    paddingVertical: LAYOUT.listRowPaddingVertical,
    paddingHorizontal: LAYOUT.listRowPaddingHorizontal,
  },
  grow: { flex: 1 },
  mark: { width: MARK, height: MARK, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 2 },
  markDot: { width: MARK / 2, height: MARK / 2, borderRadius: MARK / 4 },
  folded: {
    minHeight: LAYOUT.listRowMinHeight,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACE[3],
    paddingHorizontal: LAYOUT.listRowPaddingHorizontal,
    backgroundColor: t.colors['sheet-group'],
    borderRadius: RADII.lg.radius,
    borderCurve: 'continuous' as const,
  },
  row: {
    minHeight: PLAN_ROW.minHeight,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACE[3],
    paddingVertical: LAYOUT.listRowPaddingVertical,
    paddingHorizontal: LAYOUT.listRowPaddingHorizontal,
    backgroundColor: t.colors['sheet-group'],
    borderRadius: RADII.lg.radius,
    borderCurve: 'continuous' as const,
  },
  rowEditing: { gap: SPACE[3], padding: LAYOUT.listRowPaddingHorizontal, backgroundColor: t.colors['sheet-group'], borderRadius: RADII.lg.radius, borderCurve: 'continuous' as const },
  rowActions: { flexDirection: 'row' as const, justifyContent: 'flex-end' as const, gap: SPACE[2] },
  rows: { gap: SPACE[2] },
  card: { gap: SPACE[2], padding: LAYOUT.cardPadding, backgroundColor: t.colors['sheet-group'], borderRadius: RADII.lg.radius, borderCurve: 'continuous' as const },
  skeletonChips: { flexDirection: 'row' as const, gap: SPACE[2], marginTop: SPACE[2] },
}));

/** The app being changed: its 24 pt tile and "Changing <name>". */
function ChangingLine({ app }: Readonly<{ app: InstalledApp }>) {
  const s = styles(useTokens());
  const tile = tileOf(app);
  return (
    <View style={s.changing}>
      <TilePlate size="inline" state="ready" tint={tile.tint} glyph={tile.icon} />
      <Text type="callout" color="text-2">
        {editingEyebrow(app.name)}
      </Text>
    </View>
  );
}

/** The radio (one pick, a ring with a dot) or checkbox (several, a square with a `check`) that
 *  shows an option row can be chosen, and whether it is. "Decide for me" draws it in `ember`, every
 *  other option in `ink`. */
export function OptionMark({ multiple, checked, decide }: Readonly<{ multiple: boolean; checked: boolean; decide: boolean }>) {
  const t = useTokens();
  const s = styles(t);
  const accent = decide ? t.colors.ember : t.colors.ink;
  const shape = { borderRadius: multiple ? RADII.sm.radius : MARK / 2, borderColor: checked ? accent : t.colors['text-2'], backgroundColor: checked && multiple ? accent : 'transparent' };
  let inside: React.ReactNode = null;
  if (checked) inside = multiple ? <Icon name="check" size={16} color={decide ? t.colors['on-ember'] : t.colors['on-ink']} /> : <View style={[s.markDot, { backgroundColor: accent }]} />;
  return (
    <View style={[s.mark, shape]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {inside}
    </View>
  );
}

/** One full-width option row (system.md §7.1 Question row): a radio (one pick) or a checkbox
 *  (several) ahead of the label. "Decide for me" keeps its chip look: `ember-text` label,
 *  `ember-soft` fill when picked. */
function OptionRow({ label, checked, multiple, decide, onPress, last }: Readonly<{ label: string; checked: boolean; multiple: boolean; decide: boolean; onPress: () => void; last: boolean }>) {
  const t = useTokens();
  const s = styles(t);
  const resting = decide && checked ? { backgroundColor: t.colors['ember-soft'] } : null;
  return (
    <>
      <Pressable
        onPress={onPress}
        pressRetentionOffset={PRESS_RETENTION}
        style={({ pressed }) => [s.option, pressed ? { backgroundColor: t.colors.fill } : resting]}
        accessibilityRole={multiple ? 'checkbox' : 'radio'}
        accessibilityLabel={label}
        accessibilityState={{ checked }}
      >
        <OptionMark multiple={multiple} checked={checked} decide={decide} />
        <View style={s.grow}>
          <Text color={decide ? 'ember-text' : 'text'}>{label}</Text>
        </View>
      </Pressable>
      {last ? null : <View style={s.separator} />}
    </>
  );
}

interface QuestionRowProps {
  question: FlowQuestion;
  answer: FlowAnswer;
  folded: boolean;
  onAnswer: (change: AnswerChange) => void;
  onReopen: () => void;
  onExtent: (extent: BlockExtent) => void;
}

/** One question (system.md §7.1 Question row): the question in `headline`, an optional hint, its
 *  options as wrapping chips (every option ≤ 20 characters) or as full-width rows, "Decide for me"
 *  last, then "Other" when allowed. Answered and scrolled past, it is one line that reopens. */
function QuestionRow({ question, answer, folded, onAnswer, onReopen, onExtent }: Readonly<QuestionRowProps>) {
  const t = useTokens();
  const s = styles(t);
  const multiple = question.select === 'many';
  if (folded) {
    const summary = answerSummary(question, answer);
    return (
      <Pressable
        onPress={onReopen}
        onLayout={(event) => onExtent(event.nativeEvent.layout)}
        pressRetentionOffset={PRESS_RETENTION}
        style={s.folded}
        accessibilityRole="button"
        accessibilityLabel={`${question.question}, ${summary}`}
        accessibilityHint={COPY.planQuestionReopenHint}
      >
        <View style={s.grow}>
          <Text numberOfLines={1}>{summary}</Text>
        </View>
        <Icon name="chevron-down" size={20} color={t.colors['text-2']} />
      </Pressable>
    );
  }
  const chips = showsChips(question);
  const options = [...question.options.map((option) => ({ label: option, checked: answer.choices.includes(option), change: { kind: 'pick', option } as AnswerChange })), { label: COPY.clarifyDecide, checked: answer.decide, change: { kind: 'decide' } as AnswerChange }];
  return (
    <View style={s.question} onLayout={(event) => onExtent(event.nativeEvent.layout)}>
      <Text type="headline">{question.question}</Text>
      {multiple ? (
        <Text type="footnote" color="text-2">
          {COPY.clarifyPickMany}
        </Text>
      ) : null}
      {chips ? (
        <View style={s.chips}>
          {options.map((option, i) => (
            <Chip
              key={option.label}
              label={option.label}
              kind={i === options.length - 1 ? 'decide' : 'choice'}
              selected={option.checked}
              multiple={multiple}
              onPress={() => onAnswer(option.change)}
            />
          ))}
        </View>
      ) : (
        <View style={s.group}>
          {options.map((option, i) => (
            <OptionRow key={option.label} label={option.label} checked={option.checked} multiple={multiple} decide={i === options.length - 1} last={i === options.length - 1} onPress={() => onAnswer(option.change)} />
          ))}
        </View>
      )}
      {question.other ? (
        <TextField
          value={answer.other}
          onChangeText={(text) => onAnswer({ kind: 'type', text })}
          placeholder={COPY.clarifyOtherPlaceholder}
          accessibilityLabel={`${question.question}, ${COPY.clarifyOtherPlaceholder}`}
          maxLength={OTHER_ANSWER_MAX_CHARS}
          returnKeyType="done"
        />
      ) : null}
    </View>
  );
}

/** A question's loading state: the shape it will have (a bar over a row of chips). */
function QuestionsSkeleton() {
  const s = styles(useTokens());
  return (
    <Skeleton label={COPY.workingClarify}>
      <SkeletonBlock width={QUESTION_SKELETON.barWidth} height={QUESTION_SKELETON.barHeight} radius={RADII.xs.radius} />
      <View style={s.skeletonChips}>
        {QUESTION_SKELETON.chipWidths.map((width) => (
          <SkeletonBlock key={width} width={width} height={CHIP.height} radius={RADII.full.radius} />
        ))}
      </View>
    </Skeleton>
  );
}

/** The plan rows' loading state: the rows' exact geometry, deliberately irregular in width so identical
 *  bars never read as a progress bar. */
function RowsSkeleton({ editing }: Readonly<{ editing: boolean }>) {
  const s = styles(useTokens());
  const widths = ['100%', '92%', '84%'] as const;
  return (
    <Skeleton label={workingPlanPhrase(editing)} style={s.rows}>
      {widths.slice(0, PLAN_ROW.count).map((width) => (
        <SkeletonBlock key={width} width={width} height={PLAN_ROW.minHeight} radius={RADII.lg.radius} />
      ))}
    </Skeleton>
  );
}

interface PlanRowViewProps {
  row: FlowPlanRow;
  editing: boolean;
  onStart: () => void;
  onSave: (text: string) => void;
  onCancel: () => void;
}

/** A plan row: the label over the model's words, a pencil trailing; a row the person rewrote shows
 *  their words as typed and "Edited". Tapped, it becomes a field with Save and Cancel in place. */
function PlanRowView({ row, editing, onStart, onSave, onCancel }: Readonly<PlanRowViewProps>) {
  const t = useTokens();
  const s = styles(t);
  const [draft, setDraft] = useState(row.text);
  const block = useRef<View>(null);
  if (editing) {
    return (
      <View ref={block} style={s.rowEditing}>
        {row.label.length > 0 ? (
          <Text type="footnote" header color="text-2">
            {row.label}
          </Text>
        ) : null}
        <TextArea value={draft} onChangeText={setDraft} accessibilityLabel={row.label.length > 0 ? row.label : COPY.planRowFieldLabel} revealTarget={block} autoFocus />
        <View style={s.rowActions}>
          <Button label={COPY.cancel} variant="plain" size="medium" onPress={onCancel} />
          <Button label={COPY.planRowSave} variant="ink" size="medium" disabled={draft.trim().length === 0} onPress={() => onSave(draft)} />
        </View>
      </View>
    );
  }
  const label = [row.label, row.text, row.edited ? COPY.planRowEdited : ''].filter((part) => part.length > 0).join(', ');
  return (
    <Pressable
      onPress={() => {
        setDraft(row.text);
        onStart();
      }}
      pressRetentionOffset={PRESS_RETENTION}
      style={s.row}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={COPY.planRowEditHint}
    >
      <View style={s.grow}>
        {row.label.length > 0 ? (
          <Text type="footnote" header color="text-2">
            {row.label}
          </Text>
        ) : null}
        {row.edited ? <Text>{row.text}</Text> : <WhimProse text={row.text} style={{ ...typeStyle('body'), color: t.colors.text }} />}
      </View>
      {row.edited ? (
        <Text type="footnote" color="text-2">
          {COPY.planRowEdited}
        </Text>
      ) : (
        <Icon name="pencil" size={16} color={t.colors['text-2']} />
      )}
    </Pressable>
  );
}

interface PlanRowsProps {
  rows: readonly FlowPlanRow[];
  /** The plan is on its way: skeleton rows stand in. */
  arriving: boolean;
  changing: boolean;
  editingRow: number | null;
  onEditing: (index: number | null) => void;
  onChangeRow: (index: number, text: string) => void;
}

/** "What I'll make" and its rows, or their skeletons. With neither (the plan did not arrive) no label
 *  is drawn: it would head an empty gap. */
function PlanRows({ rows, arriving, changing, editingRow, onEditing, onChangeRow }: Readonly<PlanRowsProps>) {
  const s = styles(useTokens());
  if (!arriving && rows.length === 0) return null;
  return (
    <>
      <Text type="footnote" header color="text-2">
        {planMakeHeader(changing)}
      </Text>
      {arriving ? <RowsSkeleton editing={changing} /> : null}
      <View style={s.rows}>
        {rows.map((row, index) => (
          <PlanRowView
            key={`${index}:${row.label}`}
            row={row}
            editing={editingRow === index}
            onStart={() => onEditing(index)}
            onSave={(text) => {
              onChangeRow(index, text);
              onEditing(null);
            }}
            onCancel={() => onEditing(null)}
          />
        ))}
      </View>
    </>
  );
}

export function PlanPage({ screen, editing, onBack, onAnswer, onChangeRow, onMake, onTryAgain, onMakeInstead }: Readonly<PlanPageProps>) {
  const t = useTokens();
  const s = styles(t);
  const changing = editing !== undefined;
  const gated = useRetryGate(screen.notice?.retryAt);
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const extents = useRef<Record<string, BlockExtent>>({});
  const handleBack = () => {
    if (planBackAction(editingRow !== null) === 'cancel-edit') setEditingRow(null);
    else onBack();
  };
  useSheetBack(handleBack);
  const onScrollOffset = useCallback(
    (offset: number) => setFolded((current) => foldedAt(current, offset, extents.current, screen.answers)),
    [screen.answers],
  );
  const reopen = (id: string) => setFolded((current) => new Set([...current].filter((other) => other !== id)));
  const recordExtent = (id: string, extent: BlockExtent) => {
    extents.current[id] = extent;
  };
  const quoted = <Text type="title2" italic>{`“${screen.text}”`}</Text>;

  if (screen.limit) {
    return (
      <KeyboardShell
        host="sheet"
        contentContainerStyle={s.content}
        header={<PageHead onBack={handleBack} />}
        footer={
          <View style={s.footer}>
            <Button label={COPY.planMakeInstead} variant="ember" onPress={onMakeInstead} />
            <Button label={COPY.planChangeIdea} variant="plain" onPress={onBack} />
          </View>
        }
      >
        {editing ? <ChangingLine app={editing} /> : null}
        <Text type="title1">{COPY.planLimitHeadline}</Text>
        {quoted}
        <Text>{screen.limit.reason}</Text>
        <View style={s.card}>
          <Text type="footnote" header color="text-2">
            {COPY.planLimitCardLead}
          </Text>
          <Text>{screen.limit.alternative}</Text>
        </View>
      </KeyboardShell>
    );
  }

  const showChoices = screen.asking || screen.questions.length > 0;
  const planArriving = screen.loading && !screen.problem;
  return (
    <KeyboardShell
      host="sheet"
      contentContainerStyle={s.content}
      onScrollOffset={onScrollOffset}
      header={<PageHead onBack={handleBack} />}
      footer={
        <View style={s.footer}>
          {screen.problem ? <Notice tone="danger" message={screen.problem.reason} /> : null}
          {screen.notice ? <FlowNoticeBlock notice={screen.notice} /> : null}
          {screen.problem ? (
            <Button label={COPY.planTryAgain} variant="ember" onPress={onTryAgain} />
          ) : (
            <Button
              label={changing ? COPY.planBuildEdit : COPY.planBuild}
              variant="ember"
              haptic="handoff"
              busy={screen.loading ? COPY.planBusy : undefined}
              disabled={gated || editingRow !== null}
              onPress={onMake}
            />
          )}
        </View>
      }
    >
      {editing ? <ChangingLine app={editing} /> : null}
      <Text type="title1">{planHeadline(changing)}</Text>
      {quoted}
      {showChoices ? (
        <Text type="footnote" header color="text-2">
          {COPY.planChoicesHeader}
        </Text>
      ) : null}
      {screen.asking ? <QuestionsSkeleton /> : null}
      {screen.questions.map((question) => (
        <QuestionRow
          key={question.id}
          question={question}
          answer={screen.answers[question.id] ?? { choices: [], other: '', decide: true }}
          folded={folded.has(question.id) && isAnswered(screen.answers[question.id])}
          onAnswer={(change) => onAnswer(question.id, change)}
          onReopen={() => reopen(question.id)}
          onExtent={(extent) => recordExtent(question.id, extent)}
        />
      ))}
      <PlanRows
        rows={screen.rows}
        arriving={planArriving}
        changing={changing}
        editingRow={editingRow}
        onEditing={setEditingRow}
        onChangeRow={onChangeRow}
      />
    </KeyboardShell>
  );
}
