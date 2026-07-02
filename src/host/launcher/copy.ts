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
} as const;

/** "Forked from Water Counter" — fork provenance for a tile (product vocabulary). */
export function forkedFromLabel(name: string): string {
  return `Forked from ${name}`;
}

/** The delete confirmation body for a named app. */
export function deleteBody(name: string): string {
  return `“${name}” and all its data will be removed. This can’t be undone.`;
}
