/**
 * copy — every user-facing string on the LAUNCHER surface, in one place (launcher-shell / #5).
 *
 * The spec requires the launcher surface to speak PRODUCT VERBS only: no git terminology, no
 * mechanism names (realm, generation, lineage, snapshot ids in hash form), no internal
 * identifiers. Centralizing the copy here makes that checkable — `product-verbs.test.ts`
 * asserts this table carries no forbidden vocabulary (the "product-verbs guard"). "Fork",
 * "Delete", "Open" are PRODUCT verbs (the spec names them); they are allowed.
 *
 * (The DevProbeScreen — a __DEV__-only surface — deliberately shows mechanism diagnostics; it is
 * NOT the launcher surface and is out of this table's scope.)
 */
export const COPY = {
  homeTitle: 'Whim',
  homeSubtitle: 'Your apps',
  exampleBadge: 'Example',
  createTileLabel: 'make your first app',
  createTitle: 'Make your first app',
  createBody: 'Describe an app out loud and Whim builds it for you.',
  createDismiss: 'Got it',
  actionOpen: 'Open',
  actionFork: 'Fork',
  actionDelete: 'Delete',
  cancel: 'Cancel',
  deleteTitle: 'Delete this app?',
  deleteConfirm: 'Delete',
  emptyTitle: 'No apps yet',
  emptyBody: 'Tap “make your first app” to get started.',
  settingsTitle: 'Settings',
  backLabel: 'Back',
  themeSectionTitle: 'Theme',
  accentSectionTitle: 'Accent',
  cornersSectionTitle: 'Corners',
  accentDefaultLabel: 'Default',
  themeLightHint: 'Light',
  themeDarkHint: 'Dark',
  shapeSharp: 'Sharp',
  shapeSoft: 'Soft',
  shapeRound: 'Round',
  actionHistory: 'History',
  historyTitle: 'History',
  historyCurrentLabel: 'Current version',
  historyInstallLabel: 'Where this app began',
  historyRestoredToast: 'Restored this version',
  historyUndo: 'Undo',
  historyReassurance: 'Nothing is deleted — this data returns when you move to a newer version.',
  historyPinAction: 'Pin this version…',
  historyPinPlaceholder: 'Label',
  historyPinSave: 'Save',
  historyForkAction: 'Make this version its own app',
  historyMoreLabel: 'More',
} as const;

/** "Forked from Water Counter" — fork provenance for a tile (product vocabulary). */
export function forkedFromLabel(name: string): string {
  return `Forked from ${name}`;
}

/** The delete confirmation body for a named app. */
export function deleteBody(name: string): string {
  return `“${name}” and all its data will be removed. This can’t be undone.`;
}

/** Human label for a theme preset id ("ink" → "Ink"). Preset/accent ids are already plain
 *  English words (see src/sdk/theme.ts) so a straight capitalize is the whole mapping — no
 *  second name table to keep in sync with the SDK's curated lists. */
function capitalize(id: string): string {
  return id.length === 0 ? id : id[0].toUpperCase() + id.slice(1);
}

/** Display label for a theme preset id. */
export function presetLabel(id: string): string {
  return capitalize(id);
}

/** Display label for an accent id. */
export function accentLabel(id: string): string {
  return capitalize(id);
}

/** The History screen's data-shape annotation line (design D5): "Added: notes (text)". `fields`
 *  are already formatted as "<display name> (<type>)" by `history-logic.ts`. */
export function addedFieldsLine(fields: readonly string[]): string {
  return `Added: ${fields.join(', ')}`;
}
