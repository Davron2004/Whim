/**
 * flow-chrome — the "Changing <app name>" eyebrow the running page of a change still carries
 * (`BuildStep.tsx`; the making-progress pages replace it).
 */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { SPACING, TYPE_SCALE } from '../../sdk/theme';
import { editingEyebrow } from './copy';
import { SHELL_PALETTE } from './theme';

export interface EditingEyebrowProps {
  /** The app being changed, in its current display name. */
  name: string;
}

/**
 * "Changing <app name>" — the one line every gated step of the edit flow shares (C1: "the edit
 * flow reads as editing, on every step"), so a re-prompt can never again read like the new-app
 * flow (the reported bug: asked "what kind of app am I adding it to" while adding a section to an
 * existing one). Rendered only when the screen has `editing`; callers own that check.
 */
export function EditingEyebrow({ name }: Readonly<EditingEyebrowProps>) {
  return (
    <Text style={[TYPE_SCALE.eyebrow, styles.editingEyebrow, { color: SHELL_PALETTE.textMuted }]}>
      {editingEyebrow(name)}
    </Text>
  );
}

const styles = StyleSheet.create({
  editingEyebrow: { marginBottom: SPACING.xs },
});
