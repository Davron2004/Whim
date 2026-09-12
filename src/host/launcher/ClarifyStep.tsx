/**
 * ClarifyStep — the pre-stream exchange between compose and plan (`prompt-flow` spec "Clarifying
 * questions are a pre-stream exchange, never a generation stage").
 *
 * At most three questions, each a single-select set of answer pills, and no validation gate: the
 * primary action is live with zero answers, because skipping is a legitimate answer. The user's
 * submitted prompt is echoed here AS THE USER'S OWN WORDS — rendered through the shared renderer
 * with the prompt as its own stored-prompt reference, which is what gives it the `yours` class
 * rather than a paraphrase. This screen consumes and emits no `GenerationEvent`.
 */

import React, { useEffect } from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FONT_FAMILY, RADIUS, SHELL_COLORS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { COPY, clarifyHeadline } from './copy';
import { EditingEyebrow, FlowHeader, PrimaryAction } from './flow-chrome';
import { ClarifyQuestionsSkeleton } from './flow-skeletons';
import { WorkingLine } from './flow-working';
import type { FlowAnswers, FlowQuestion } from './prompt-flow';
import { SHELL_PALETTE } from './theme';

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
  /** Scopes the screen to a re-prompt (C1) — present together with `editingName`. */
  editing: boolean;
  editingName?: string;
  onAnswer: (questionId: string, answer: string) => void;
  onContinue: () => void;
  /** Immediate: back lands on compose with the prompt intact. While `loading`, the caller also
   *  aborts the in-flight clarify request — this screen only navigates. */
  onBack: () => void;
}

export default function ClarifyStep({
  prompt,
  questions,
  answers,
  loading,
  startedAt,
  editing,
  editingName,
  onAnswer,
  onContinue,
  onBack,
}: Readonly<ClarifyStepProps>) {
  const p = SHELL_PALETTE;

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <FlowHeader step="clarify" onBack={onBack} />

      <ScrollView contentContainerStyle={styles.content}>
        {editing && editingName != null && <EditingEyebrow name={editingName} />}

        {/* The counted headline ("One/Two/Three quick things") depends on data that does not
            exist yet while loading — it appears only once the real questions have landed. */}
        {!loading && (
          <Text style={[TYPE_SCALE.stepTitle, { color: p.text }]}>{clarifyHeadline(questions.length)}</Text>
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

        {loading ? (
          <>
            <ClarifyQuestionsSkeleton color={p.card} />
            <WorkingLine phrase={COPY.workingClarify} startedAt={startedAt ?? Date.now()} />
          </>
        ) : (
          <>
            {questions.map((question) => (
              <View key={question.id} style={styles.question}>
                <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.text }]}>{question.question}</Text>
                <View style={styles.options}>
                  {question.options.map((option) => {
                    const selected = answers[question.id] === option;
                    return (
                      <TouchableOpacity
                        key={option}
                        onPress={() => onAnswer(question.id, option)}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        style={[
                          styles.pill,
                          {
                            backgroundColor: selected ? p.accent : p.bg,
                            borderColor: selected ? p.accent : p.cardBorder,
                          },
                        ]}
                      >
                        <Text style={[TYPE_SCALE.controlLabel, { color: selected ? p.onAccent : p.text }]}>{option}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}

            <Text style={[TYPE_SCALE.caption, styles.helper, { color: p.textMuted }]}>{COPY.clarifyHelper}</Text>
          </>
        )}
      </ScrollView>

      {/* A disabled button under a skeleton is noise — there is nothing to confirm yet. The
          action mounts once the real questions have landed; `WorkingLine` is the only liveness
          element while loading. */}
      {!loading && <PrimaryAction step="clarify" enabled editing={editing} onPress={onContinue} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // paddingTop 28: design `Whim Mobile.dc.html:442` — no SPACING counterpart (ruling R9).
  content: { paddingHorizontal: SPACING.lg, paddingTop: 28, paddingBottom: SPACING.xl },
  echo: { marginTop: SPACING.sm },
  question: { marginTop: SPACING.lg },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginTop: SPACING.sm },
  pill: {
    borderWidth: 1,
    borderRadius: RADIUS.chip,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
  },
  helper: { marginTop: SPACING.lg },
});
