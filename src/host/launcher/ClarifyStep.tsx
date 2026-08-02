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
import { RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import WhimProse from '../ui/whim-prose/WhimProse';
import { COPY, clarifyHeadline } from './copy';
import { FlowHeader, PrimaryAction } from './flow-chrome';
import type { FlowAnswers, FlowQuestion } from './prompt-flow';
import { shellPalette } from './theme';
import { useTheme } from './theme-context';

export interface ClarifyStepProps {
  /** The user's submitted prompt, echoed verbatim as their own words. */
  prompt: string;
  questions: readonly FlowQuestion[];
  answers: FlowAnswers;
  busy: boolean;
  onAnswer: (questionId: string, answer: string) => void;
  onContinue: () => void;
  /** Immediate: back lands on compose with the prompt intact. */
  onBack: () => void;
}

export default function ClarifyStep({
  prompt,
  questions,
  answers,
  busy,
  onAnswer,
  onContinue,
  onBack,
}: Readonly<ClarifyStepProps>) {
  const { theme } = useTheme();
  const p = shellPalette(theme);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <FlowHeader step="clarify" palette={p} onBack={onBack} />

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[TYPE_SCALE.screenTitle, { color: p.text }]}>{clarifyHeadline(questions.length)}</Text>

        <WhimProse text={prompt} storedPrompt={prompt} style={[TYPE_SCALE.quote, styles.echo]} />

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
                    <Text style={[TYPE_SCALE.caption, { color: selected ? p.onAccent : p.text }]}>{option}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}

        <Text style={[TYPE_SCALE.caption, styles.helper, { color: p.textMuted }]}>{COPY.clarifyHelper}</Text>
      </ScrollView>

      <PrimaryAction step="clarify" busy={busy} enabled palette={p} onPress={onContinue} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xl },
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
