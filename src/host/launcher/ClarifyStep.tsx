/**
 * ClarifyStep — the pre-stream exchange between compose and plan (`prompt-flow` spec "Clarifying
 * questions are a pre-stream exchange, never a generation stage").
 *
 * At most three questions, each a set of answer pills — one pick for a `select: 'one'` question
 * (a second tap moves it), several for `'many'` — plus a typed "Other" answer where the question
 * allows one, and "Decide for me" on every question (beta-1 D18). There is no validation gate: the
 * primary action is live with zero answers, because skipping is a legitimate answer. The user's
 * submitted prompt is echoed here AS THE USER'S OWN WORDS — rendered through the shared renderer
 * with the prompt as its own stored-prompt reference, which is what gives it the `yours` class
 * rather than a paraphrase. This screen consumes and emits no `GenerationEvent`.
 *
 * When clarify answers that the request can't be built as asked (`limit`, beta-1 D9) the step shows
 * the reason and offers the alternative instead of questions: `Build <alternative> instead` and
 * `Change my idea` (the same move as Back). Nothing on it starts a build on its own.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FONT_FAMILY, RADIUS, SHELL_COLORS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { COPY, clarifyBuildInstead, clarifyHeadline } from './copy';
import { EditingEyebrow, FLOW_HEADER_GAP, FlowHeader, PrimaryAction, StepNotice } from './flow-chrome';
import { ClarifyQuestionsSkeleton } from './flow-skeletons';
import { WorkingLine } from './flow-working';
import KeyboardShell, { KeyboardTextInput } from './KeyboardShell';
import {
  OTHER_ANSWER_MAX_CHARS,
  type AnswerChange,
  type FlowAnswer,
  type FlowAnswers,
  type FlowLimit,
  type FlowNotice,
  type FlowQuestion,
} from './prompt-flow';
import { useRetryGate } from './ServiceNotice';
import { SHELL_PALETTE } from './theme';
import { useSystemBack } from './use-system-back';

export interface ClarifyStepProps {
  /** The user's submitted prompt, echoed verbatim as their own words. */
  prompt: string;
  questions: readonly FlowQuestion[];
  answers: FlowAnswers;
  /** The clarify exchange is still in flight (C2): the step renders its own loading state —
   *  `ClarifyQuestionsSkeleton` plus a `WorkingLine` — instead of the real questions. */
  loading: boolean;
  /** When the in-flight exchange started, for `WorkingLine`'s clock. Only read while `loading`. */
  startedAt?: number;
  /** A service refusal that landed here (design D9/D12) — always a `sender`-landing refusal (an
   *  availability/limit code), never about the answers themselves. */
  notice?: FlowNotice;
  /** Clarify answered that the request can't be built as asked: the step shows this instead of
   *  questions. */
  limit?: FlowLimit;
  /** Scopes the screen to a re-prompt (C1) — present together with `editingName`. */
  editing: boolean;
  editingName?: string;
  /** One change to one question's answer: a pill tapped, the "Other" field typed into, or
   *  "Decide for me" tapped. The caller folds it in (`prompt-flow.ts#withAnswer`). */
  onAnswer: (questionId: string, change: AnswerChange) => void;
  onContinue: () => void;
  /** The limit step's `Build <alternative> instead`: the caller makes the alternative the prompt
   *  and asks clarify about it. Only read while `limit` is set. */
  onBuildInstead?: () => void;
  /** Immediate: back lands on compose with the prompt intact. While `loading`, the caller also
   *  aborts the in-flight clarify request — this screen only navigates. The limit step's
   *  `Change my idea` is this same move. */
  onBack: () => void;
}

const UNANSWERED: FlowAnswer = { choices: [], other: '', decide: false };

export default function ClarifyStep({
  prompt,
  questions,
  answers,
  loading,
  startedAt,
  notice,
  limit,
  editing,
  editingName,
  onAnswer,
  onContinue,
  onBuildInstead,
  onBack,
}: Readonly<ClarifyStepProps>) {
  const p = SHELL_PALETTE;
  const gated = useRetryGate(notice?.retryAt);
  useSystemBack(onBack);

  return (
    <KeyboardShell
      style={{ backgroundColor: p.bg }}
      contentContainerStyle={styles.content}
      header={<FlowHeader step="clarify" onBack={onBack} />}
      footer={
        <>
          <StepNotice notice={notice} />
          {/* A disabled button under a skeleton is noise — there is nothing to confirm yet. The
              action mounts once the real questions have landed; `WorkingLine` is the only liveness
              element while loading. No validation gate of its own — the retry window is the only
              thing that can disable it. */}
          {limit && <LimitActions alternative={limit.alternative} enabled={!gated} onBuildInstead={onBuildInstead} onChangeIdea={onBack} />}
          {!limit && !loading && <PrimaryAction step="clarify" enabled={!gated} editing={editing} onPress={onContinue} />}
        </>
      }
    >
      {editing && editingName != null && <EditingEyebrow name={editingName} />}

      {/* The counted headline ("One/Two/Three quick things") depends on data that does not
          exist yet while loading — it appears only once the real questions have landed. */}
      {!loading && (
        <Text style={[TYPE_SCALE.stepTitle, { color: p.text }]}>
          {limit ? COPY.clarifyLimitHeadline : clarifyHeadline(questions.length)}
        </Text>
      )}

      {/*
        The echoed prompt is a standalone block of the user's own words (design doc "`yours` —
        the brown": "Upright brown when the user's words stand alone as a block"), NOT the
        Newsreader-italic inline form the shared renderer applies mid-sentence. Rendered as
        plain `Text` — not through `WhimProse` — so the renderer never gets a second chance to
        mark this block up.
      */}
      <Text
        style={[
          TYPE_SCALE.body,
          styles.echo,
          { fontFamily: FONT_FAMILY.sansRegular, color: SHELL_COLORS.yours },
        ]}
      >
        {prompt}
      </Text>

      <ClarifyBody loading={loading} startedAt={startedAt} limit={limit} questions={questions} answers={answers} onAnswer={onAnswer} />
    </KeyboardShell>
  );
}

/** Under the echoed prompt: the skeleton while loading, the limit's reason, or the questions. */
function ClarifyBody({
  loading,
  startedAt,
  limit,
  questions,
  answers,
  onAnswer,
}: Readonly<Pick<ClarifyStepProps, 'loading' | 'startedAt' | 'limit' | 'questions' | 'answers' | 'onAnswer'>>) {
  const p = SHELL_PALETTE;
  if (loading) {
    return (
      <>
        <ClarifyQuestionsSkeleton color={p.card} />
        <WorkingLine phrase={COPY.workingClarify} startedAt={startedAt ?? Date.now()} />
      </>
    );
  }
  if (limit) {
    // The server's own words, as plain text: never parsed, linked or formatted.
    return <Text style={[TYPE_SCALE.body, styles.reason, { color: p.text }]}>{limit.reason}</Text>;
  }
  return (
    <>
      {questions.map((question) => (
        <QuestionAnswers
          key={question.id}
          question={question}
          answer={answers[question.id] ?? UNANSWERED}
          onChange={(change) => onAnswer(question.id, change)}
        />
      ))}
      <Text style={[TYPE_SCALE.caption, styles.helper, { color: p.textMuted }]}>{COPY.clarifyHelper}</Text>
    </>
  );
}

/** One question: its pills, "Decide for me", and the "Other" field when it allows one. */
function QuestionAnswers({
  question,
  answer,
  onChange,
}: Readonly<{ question: FlowQuestion; answer: FlowAnswer; onChange: (change: AnswerChange) => void }>) {
  const p = SHELL_PALETTE;
  const role = question.select === 'many' ? 'checkbox' : 'radio';
  return (
    <View style={styles.question}>
      <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.text }]}>{question.question}</Text>
      {question.select === 'many' && (
        <Text style={[TYPE_SCALE.caption, styles.pickMany, { color: p.textMuted }]}>{COPY.clarifyPickMany}</Text>
      )}
      <View style={styles.options}>
        {question.options.map((option) => (
          <AnswerPill
            key={`option:${option}`}
            label={option}
            role={role}
            selected={answer.choices.includes(option)}
            onPress={() => onChange({ kind: 'pick', option })}
          />
        ))}
        <AnswerPill
          key="decide"
          label={COPY.clarifyDecide}
          role={role}
          selected={answer.decide}
          delegate
          onPress={() => onChange({ kind: 'decide' })}
        />
      </View>
      {question.other && <OtherAnswerField value={answer.other} onChangeText={(text) => onChange({ kind: 'type', text })} />}
    </View>
  );
}

/** One answer pill. `delegate` marks "Decide for me", which reads as a choice about the question
 *  rather than an answer to it: a dashed outline until it is picked. */
function AnswerPill({
  label,
  role,
  selected,
  delegate = false,
  onPress,
}: Readonly<{ label: string; role: 'radio' | 'checkbox'; selected: boolean; delegate?: boolean; onPress: () => void }>) {
  const p = SHELL_PALETTE;
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole={role}
      accessibilityState={{ selected, checked: selected }}
      style={[
        styles.pill,
        delegate && !selected && styles.delegatePill,
        { backgroundColor: selected ? p.accent : p.bg, borderColor: selected ? p.accent : p.cardBorder },
      ]}
    >
      <Text style={[TYPE_SCALE.controlLabel, { color: selected ? p.onAccent : p.text }]}>{label}</Text>
    </TouchableOpacity>
  );
}

/**
 * The typed "Other" answer (beta-1 D18): one line, capped at the contract's 200 characters, holding
 * exactly what was typed (it is trimmed only when sent). The step's `KeyboardShell` keeps it above
 * the keyboard; being one line, Return puts the keyboard away.
 */
function OtherAnswerField({ value, onChangeText }: Readonly<{ value: string; onChangeText: (text: string) => void }>) {
  const p = SHELL_PALETTE;
  return (
    <KeyboardTextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={COPY.clarifyOtherPlaceholder}
      placeholderTextColor={p.textMuted}
      maxLength={OTHER_ANSWER_MAX_CHARS}
      returnKeyType="done"
      style={[TYPE_SCALE.body, styles.other, { color: p.text, backgroundColor: p.card, borderColor: p.cardBorder }]}
    />
  );
}

/** The limit step's two actions: build the alternative (its label names it, and wraps when long),
 *  or go back and change the idea. */
function LimitActions({
  alternative,
  enabled,
  onBuildInstead,
  onChangeIdea,
}: Readonly<{ alternative: string; enabled: boolean; onBuildInstead?: () => void; onChangeIdea: () => void }>) {
  const p = SHELL_PALETTE;
  const label = clarifyBuildInstead(alternative);
  return (
    <View>
      <TouchableOpacity
        onPress={onBuildInstead}
        disabled={!enabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[styles.buildInstead, { backgroundColor: enabled ? p.accent : p.card, borderColor: p.cardBorder }]}
      >
        <Text style={[TYPE_SCALE.bodyEmphatic, styles.buildInsteadLabel, { color: enabled ? p.onAccent : p.textMuted }]}>{label}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onChangeIdea} accessibilityRole="button" style={styles.changeIdea}>
        <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.textMuted }]}>{COPY.clarifyLimitChangeIdea}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  // design `Whim Mobile.dc.html:442` is `padding:28px 22px 0` — 28 has no SPACING counterpart
  // (ruling R9); the gap below the helper line is the shell footer's 16, above Continue.
  content: { paddingHorizontal: SPACING.lg, paddingTop: 28 - FLOW_HEADER_GAP, paddingBottom: 0 },
  echo: { marginTop: SPACING.sm },
  reason: { marginTop: SPACING.lg },
  question: { marginTop: SPACING.lg },
  pickMany: { marginTop: SPACING.xs },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginTop: SPACING.sm },
  pill: {
    borderWidth: 1,
    borderRadius: RADIUS.chip,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
  },
  delegatePill: { borderStyle: 'dashed' },
  other: {
    marginTop: SPACING.sm,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderWidth: 1,
    borderRadius: RADIUS.field,
  },
  helper: { marginTop: SPACING.lg },
  // The primary action's footprint (`flow-chrome.tsx#PrimaryAction`: 52 high, 24 below), but free
  // to grow: its label carries the alternative, which can run to two lines.
  buildInstead: {
    minHeight: 52,
    marginHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buildInsteadLabel: { textAlign: 'center' },
  changeIdea: { height: 46, marginBottom: SPACING.lg, alignItems: 'center', justifyContent: 'center' },
});
