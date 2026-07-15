/**
 * deliver Node suite (E5) — covers the `deliverBySourceJs` guard paths that only the Chromium
 * end-to-end test exercised before: within-limit success, over-limit `BundleTooLargeError`
 * (message + `.bytes`), and the `byteLength` UTF-8/char-count fallback when `TextEncoder` is
 * absent (Hermes-shaped: the source engine has no TextEncoder despite the test runner having one).
 */

import { Harness } from './harness';
import { deliverBySourceJs, BundleTooLargeError, MAX_BUNDLE_SOURCE_BYTES } from '../deliver';

export async function runDeliverTests(h: Harness): Promise<void> {
  // (1) within-limit returns a string
  await h.test('deliver within-limit source returns the injectJavaScript string', async () => {
    const r = deliverBySourceJs({ name: 'x', source: 'a'.repeat(MAX_BUNDLE_SOURCE_BYTES - 100), generation: 1 });
    h.ok(typeof r === 'string', 'deliverBySourceJs returns a string for a within-limit source');
  });

  // (2) over-limit throws BundleTooLargeError with the correct .bytes
  await h.test('deliver over-limit source throws BundleTooLargeError with correct .bytes', async () => {
    // ASCII source so byte length == char length: exactly MAX_BUNDLE_SOURCE_BYTES + 1 bytes.
    const overLimit = 'a'.repeat(MAX_BUNDLE_SOURCE_BYTES + 1);
    await h.throws(
      () => deliverBySourceJs({ name: 'x', source: overLimit, generation: 1 }),
      'over the',
      'over-limit source throws with the delivery-limit message',
    );
    try {
      deliverBySourceJs({ name: 'x', source: overLimit, generation: 1 });
      h.ok(false, 'expected deliverBySourceJs to throw for an over-limit source');
    } catch (err) {
      h.eq((err as BundleTooLargeError).bytes, MAX_BUNDLE_SOURCE_BYTES + 1, 'thrown error reports the actual byte count');
    }
  });

  // (3) byteLength falls back to s.length when TextEncoder is undefined — rigorous variant.
  //
  // '😀' (U+1F600) is a surrogate pair: 2 UTF-16 code units (counts as 2 toward `.length`) and
  // 4 UTF-8 bytes. Repeating it N=140000 times gives:
  //   char count  (s.length)        = 2 * 140000 = 280000  < MAX_BUNDLE_SOURCE_BYTES (524288)
  //   UTF-8 bytes (TextEncoder path) = 4 * 140000 = 560000  > MAX_BUNDLE_SOURCE_BYTES (524288)
  // So with TextEncoder present this source would throw BundleTooLargeError; with TextEncoder
  // nulled, byteLength's catch branch falls back to s.length (280000, under the limit), so the
  // call must succeed instead — a real fork in behavior, not a vacuous assertion.
  await h.test('deliver byteLength falls back to s.length when TextEncoder is undefined', async () => {
    const multibyteSource = '\u{1F600}'.repeat(140000);
    h.ok(multibyteSource.length < MAX_BUNDLE_SOURCE_BYTES, 'sanity: char count is under the limit');
    const saved = globalThis.TextEncoder;
    try {
      // @ts-expect-error -- deliberately undefining TextEncoder to force the fallback path
      globalThis.TextEncoder = undefined;
      const r = deliverBySourceJs({ name: 'x', source: multibyteSource, generation: 1 });
      h.ok(typeof r === 'string', 'byteLength falls back to s.length when TextEncoder is undefined (no throw)');
    } finally {
      globalThis.TextEncoder = saved;
    }
  });

  // (4) theme present → serialized options carry the JSON-stringified theme under `theme:`.
  await h.test('deliver with a theme includes the JSON-stringified theme under the theme key', async () => {
    const theme = { name: 'paper', dark: false, shape: 'soft' };
    const r = deliverBySourceJs({ name: 'x', source: 'a', generation: 1, theme });
    h.ok(r.includes(',theme:' + JSON.stringify(theme)), 'output contains the theme field serialized like the other fields');
  });

  // (5) theme absent → output is byte-identical to the pre-theme form (no "theme" substring).
  await h.test('deliver without a theme is byte-identical to the pre-theme output', async () => {
    const r = deliverBySourceJs({ name: 'x', source: 'a', generation: 1 });
    h.ok(!r.includes('theme'), 'output has no theme field when theme is omitted');
    h.eq(
      r,
      'window.__whimControl.reinject({reset:true,bundle:"x",bundleSource:"a",generation:1})',
      'omitted theme reproduces exactly the pre-theme injectJavaScript string',
    );
  });

  // (6) a theme value containing quotes/</script> can't break out of the enclosing JS string —
  // JSON.stringify's escaping (backslash-escaped quotes) holds inside the reinject(...) call.
  await h.test('deliver theme with quotes and </script> stays inside the JS string', async () => {
    const theme = { name: String.raw`a"b</script>c\d` };
    const r = deliverBySourceJs({ name: 'x', source: 'a', generation: 1, theme });
    h.ok(r.includes(',theme:' + JSON.stringify(theme)), 'theme is embedded via the same JSON.stringify escaping as every other field');
    // Extract exactly the theme value's own serialized text (the tail of the call, after the
    // trailing `})`) and re-parse it as JSON: if the embedded quote had broken out of the JS
    // string unescaped, this slice would either fail to parse or parse to something other than
    // the original theme object.
    const idx = r.indexOf(',theme:');
    h.ok(idx !== -1, 'theme field is present to slice out');
    const themeSlice = r.slice(idx + ',theme:'.length, -2); // strip the trailing '})'
    h.eq(JSON.parse(themeSlice), theme, 'the escaped theme round-trips back to the original object');
  });
}
