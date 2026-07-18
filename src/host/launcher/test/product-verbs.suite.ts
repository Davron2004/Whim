/**
 * product-verbs guard (task 6.2, spec "The launcher surface speaks product verbs only").
 * Asserts the centralized launcher copy + derived tile visuals carry NO git terminology or
 * mechanism/internal vocabulary. "Fork", "Delete", "Open" are product verbs (allowed). This is
 * the concrete form of the spec's "product-verbs build guard".
 */

import { Harness } from './harness';
import { COPY, forkedFromLabel, deleteBody, addedFieldsLine } from '../copy';
import { monogram, tileColor } from '../tiles';

// Mechanism / git vocabulary that must never reach the launcher surface. NOTE: "fork" is NOT
// here — it is a sanctioned product verb. A raw lineage id ("fork-1") IS forbidden.
const FORBIDDEN: RegExp[] = [
  /\bgit\b/i, /\bcommit\b/i, /\boid\b/i, /\bsha\b/i, /\bhash\b/i, /\bref\b/i, /\bblob\b/i,
  /\btree\b/i, /gitdir/i, /\bHEAD\b/, /\brealm\b/i, /generation/i, /dispatcher/i, /iframe/i,
  /webview/i, /\blineage\b/i, /\bsnapshot\b/i, /fork-\d/i, /[0-9a-f]{40}/i,
];

export async function runProductVerbsTests(h: Harness): Promise<void> {
  await h.test('product-verbs: launcher copy carries no mechanism/git vocabulary', async () => {
    const strings: string[] = [
      ...Object.values(COPY),
      forkedFromLabel('Water Counter'),
      deleteBody('Tip Splitter'),
      monogram('Water Counter'),
      tileColor('Water Counter'),
      addedFieldsLine(['notes (text)']),
    ];
    for (const str of strings) {
      for (const bad of FORBIDDEN) {
        h.ok(!bad.test(str), `"${str}" must not contain mechanism term ${bad}`);
      }
    }
  });

  await h.test('product-verbs: the product verbs themselves survive (Open/Fork/Delete present)', async () => {
    h.ok(COPY.actionOpen === 'Open' && COPY.actionFork === 'Fork' && COPY.actionDelete === 'Delete', 'product verbs intact');
  });
}
