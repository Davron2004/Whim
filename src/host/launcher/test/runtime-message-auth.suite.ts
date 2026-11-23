/** The pure half of the outer page → RN provenance check (`runtime-message-auth`, webview-bridge-provenance
 *  D1, D2, D5): minting from the secure source with no fallback, the envelope verifier, the canary,
 *  the exposure grammar, and one WebView's channel across page loads. */
import { randomBytes } from 'node:crypto';
import { Harness } from './harness';
import {
  acceptRuntimeMessage,
  authControlJs,
  EXPOSURE_CANARY,
  exposureCode,
  isExposureCanary,
  mintRuntimeToken,
  RuntimeChannel,
  type ExposureRecord,
  type SecureRandomSource,
} from '../runtime-message-auth';

/** A real secure source standing in for `WhimRandom`: the OS CSPRNG through Node, with the module's
 *  contract (null outside 1–64 bytes). Every request it got is kept. */
function osRandom(): SecureRandomSource & { asked: number[] } {
  const asked: number[] = [];
  return {
    asked,
    randomHex: (n) => {
      asked.push(n);
      return Number.isInteger(n) && n >= 1 && n <= 64 ? randomBytes(n).toString('hex') : null;
    },
  };
}

/** A post as the outer page signs it once it holds `token` (`build/assemble.mjs` `toRN`). */
const signedWith = (token: string, body: string) => `W1.${token}.${body}`;

/** The `device-diagnostics` `exposure` grammar, written out from that spec's scenario. */
const EXPOSURE_GRAMMAR = /^(?:refused|timed-out|navigated:(?:none|android|ios|android\+ios)(?:\+canary)?)$/;

const record = (r: Partial<ExposureRecord> & Pick<ExposureRecord, 'outcome'>): ExposureRecord => ({
  visible: { android: false, ios: false }, canaryReachedNative: false, webview: 'chrome-131', ...r,
});

export async function runRuntimeMessageAuthTests(h: Harness): Promise<void> {
  await h.test('token: 128 bits of the secure source as 32 lowercase hex, a new one every time', () => {
    const source = osRandom();
    const a = mintRuntimeToken(source);
    const b = mintRuntimeToken(source);
    h.ok(a !== null && /^[0-9a-f]{32}$/.test(a), `32 lowercase hex (${a})`);
    h.ok(a !== b, 'two WebView instances never share a token');
    h.eq(source.asked, [16, 16], '16 bytes asked of the source each time');
  });

  await h.test('token: no secure source, no token — missing, throwing, failing or malformed, never a fallback', () => {
    h.eq(mintRuntimeToken(null), null, 'the module is missing (TurboModuleRegistry.get gave null)');
    h.eq(mintRuntimeToken(undefined), null, 'no module at all');
    h.eq(mintRuntimeToken({} as SecureRandomSource), null, 'a module without randomHex');
    h.eq(mintRuntimeToken({ randomHex: () => { throw new Error('SecRandomCopyBytes failed'); } }), null, 'the source throws');
    h.eq(mintRuntimeToken({ randomHex: () => null }), null, 'the OS call failed (null)');
    const hex = randomBytes(16).toString('hex');
    h.eq(mintRuntimeToken({ randomHex: () => hex.slice(2) }), null, 'fewer than 16 bytes');
    h.eq(mintRuntimeToken({ randomHex: () => hex.toUpperCase() }), null, 'uppercase hex is not the module’s output');
    h.eq(mintRuntimeToken({ randomHex: () => `${hex.slice(1)}g` }), null, 'a non-hex character');
  });

  await h.test('verifier: the page’s signed post yields its body; nothing else does, whatever it claims', () => {
    const token = mintRuntimeToken(osRandom())!;
    const other = mintRuntimeToken(osRandom())!;
    const body = JSON.stringify({ kind: 'paint', trusted: true, payload: { generation: 4 } });
    h.eq(acceptRuntimeMessage(signedWith(token, body), token), { ok: true, body }, 'signed with this page load’s token: the body, byte for byte');
    h.eq(acceptRuntimeMessage(body, token), { ok: false, reason: 'unsigned' }, 'the same frame unsigned');
    h.eq(acceptRuntimeMessage(signedWith(other, body), token), { ok: false, reason: 'wrong-token' }, 'signed with another token');
    const lastCharOff = token.slice(0, 31) + (token[31] === '0' ? '1' : '0');
    h.eq(acceptRuntimeMessage(signedWith(lastCharOff, body), token), { ok: false, reason: 'wrong-token' }, 'a token off by its last character');
    h.eq(acceptRuntimeMessage(signedWith(token.toUpperCase(), body), token).ok, false, 'the token in uppercase');
    h.eq(acceptRuntimeMessage(`W1.${token}${body}`, token).ok, false, 'the envelope without its closing dot');
    h.eq(acceptRuntimeMessage(`W2.${token}.${body}`, token).ok, false, 'another envelope version');
    h.eq(acceptRuntimeMessage(`W1.${token}.`, token), { ok: true, body: '' }, 'an empty body passes the envelope (the consumer’s parse refuses it)');
    h.eq(acceptRuntimeMessage(`W1.${token}`, token), { ok: false, reason: 'unsigned' }, 'shorter than the envelope');
    h.eq(acceptRuntimeMessage(signedWith(token, body), null), { ok: false, reason: 'no-token' }, 'no token for this page load: even a well-formed post is dropped');
    h.eq(acceptRuntimeMessage({ kind: 'paint' }, token), { ok: false, reason: 'unsigned' }, 'not a string');
  });

  await h.test('canary: exact equality only', () => {
    h.ok(isExposureCanary(EXPOSURE_CANARY), 'the canary');
    h.ok(!isExposureCanary(` ${EXPOSURE_CANARY}`) && !isExposureCanary(JSON.stringify(EXPOSURE_CANARY)) && !isExposureCanary(`${EXPOSURE_CANARY}\n`), 'nothing near it');
  });

  await h.test('auth control: only a runtime token is ever written into a script', () => {
    const token = mintRuntimeToken(osRandom())!;
    h.ok(authControlJs(token).includes(`auth('${token}')`), 'the token, quoted, in the auth call');
    let threw = 0;
    for (const bad of ["x');alert(1);('", '', token.toUpperCase()]) {
      try { authControlJs(bad); } catch (e) { if (e instanceof Error) threw += 1; }
    }
    h.eq(threw, 3, 'anything else is refused before it reaches a script');
  });

  await h.test('exposure code: every result in the device-diagnostics grammar, the canary carried on a navigation', () => {
    const cases: [ExposureRecord, string][] = [
      [record({ outcome: 'refused' }), 'refused'],
      [record({ outcome: 'timedOut' }), 'timed-out'],
      [record({ outcome: 'navigated' }), 'navigated:none'],
      [record({ outcome: 'navigated', visible: { android: true, ios: false } }), 'navigated:android'],
      [record({ outcome: 'navigated', visible: { android: false, ios: true } }), 'navigated:ios'],
      [record({ outcome: 'navigated', visible: { android: true, ios: true } }), 'navigated:android+ios'],
      [record({ outcome: 'navigated', visible: { android: true, ios: false }, canaryReachedNative: true }), 'navigated:android+canary'],
      [record({ outcome: 'navigated', canaryReachedNative: true }), 'navigated:none+canary'],
    ];
    h.eq(cases.map(([r]) => exposureCode(r)), cases.map(([, code]) => code), 'each result as its code');
    h.ok(cases.every(([r]) => EXPOSURE_GRAMMAR.test(exposureCode(r))), 'all inside the grammar');
    h.ok(EXPOSURE_GRAMMAR.test(exposureCode(record({ outcome: 'refused', canaryReachedNative: true }))), 'a canary beside a refusal stays inside the grammar');
  });

  await h.test('channel: one token per WebView, minted at its first load end and handed over again unchanged at every later one; another channel’s token is refused', () => {
    const channel = new RuntimeChannel(osRandom());
    const injected: string[] = [];
    h.ok(!channel.authorized, 'a WebView starts unauthorized');
    h.eq(channel.deliver((js) => injected.push(js)), true, 'its token goes to the loaded page');
    const first = /auth\('([0-9a-f]{32})'\)/.exec(injected[0] ?? '')?.[1] ?? '';
    h.ok(channel.authorized && first.length === 32, 'and the channel says so');
    h.eq(channel.receive(signedWith(first, '{"__whimWarm":true}')), '{"__whimWarm":true}', 'a post signed with it is read');
    h.eq(channel.deliver((js) => injected.push(js)), true, 'a repeated load end delivers again');
    h.eq(injected[1], injected[0], 'the same token, never a new one');
    h.eq(channel.receive(signedWith(first, '{"__whimWarm":true}')), '{"__whimWarm":true}', 'so the page’s posts are still read');
    const other = new RuntimeChannel(osRandom());
    other.deliver((js) => injected.push(js));
    const second = /auth\('([0-9a-f]{32})'\)/.exec(injected[2] ?? '')?.[1] ?? '';
    h.ok(second.length === 32 && second !== first, 'another WebView gets a token of its own');
    h.eq(other.receive(signedWith(first, '{"__whimWarm":true}')), null, 'the first WebView’s token is refused there');
    h.eq(other.receive(signedWith(second, '{"__whimWarm":true}')), '{"__whimWarm":true}', 'its own is read');
    h.eq([channel.snapshot().dropped, other.snapshot().dropped], [0, 1], 'one message dropped, and counted on its WebView');
  });

  await h.test('channel: with no secure source nothing is delivered, the failure is reported, and every message is dropped and counted', () => {
    for (const [name, source] of [['missing', null], ['failing', { randomHex: () => null }], ['throwing', { randomHex: () => { throw new Error('no'); } }]] as const) {
      let failures = 0;
      const channel = new RuntimeChannel(source, { noToken: () => { failures += 1; } });
      const injected: string[] = [];
      h.eq([channel.deliver((js) => injected.push(js)), injected, channel.authorized], [false, [], false], `${name}: no auth is injected`);
      h.eq([channel.deliver((js) => injected.push(js)), injected], [false, []], `${name}: nor at a later load end`);
      h.eq(failures, 1, `${name}: the failure is reported once for the WebView`);
      const forged = [
        JSON.stringify({ kind: 'paint', trusted: true, payload: { generation: 1 } }),
        signedWith('0'.repeat(32), JSON.stringify({ kind: 'paint', trusted: true, payload: { generation: 1 } })),
        signedWith('0'.repeat(32), JSON.stringify({ kind: 'bridge-exposure', payload: { outcome: 'refused', visible: { android: false, ios: false }, webview: 'webkit' } })),
      ];
      h.eq(forged.map((raw) => channel.receive(raw)), [null, null, null], `${name}: nothing is read`);
      h.eq([channel.snapshot().dropped, channel.snapshot().exposure], [3, null], `${name}: each is counted, none recorded`);
    }
  });

  await h.test('channel: the first load end settles the token once, for whatever waits on it (delivered, after it went in), at once once settled, and a cancelled wait hears nothing', () => {
    const channel = new RuntimeChannel(osRandom());
    const injected: string[] = [];
    const heard: string[] = [];
    let inPageWhenHeard = false;
    channel.whenSettled((authorized) => {
      heard.push(`first:${authorized}`);
      inPageWhenHeard = injected.length === 1 && channel.authorized;
    });
    const cancel = channel.whenSettled((authorized) => heard.push(`cancelled:${authorized}`));
    cancel();
    h.eq([heard, channel.authorized, channel.tokenAbsent], [[], false, false], 'before its page loads, nothing is settled');
    channel.deliver((js) => injected.push(js));
    h.eq(heard, ['first:true'], 'the load end settles it as delivered, once; the cancelled wait hears nothing');
    h.ok(inPageWhenHeard, 'the wait is told only after the token went into the page');
    channel.deliver((js) => injected.push(js));
    h.eq(heard, ['first:true'], 'a repeated load end settles nothing again');
    channel.whenSettled((authorized) => heard.push(`late:${authorized}`));
    h.eq(heard, ['first:true', 'late:true'], 'a wait asked for once it is settled is answered at once');

    for (const [name, source] of [['missing', null], ['failing', { randomHex: () => null }], ['throwing', { randomHex: () => { throw new Error('no'); } }]] as const) {
      const none = new RuntimeChannel(source);
      const seen: boolean[] = [];
      none.whenSettled((authorized) => seen.push(authorized));
      h.eq([seen, none.tokenAbsent], [[], false], `${name}: undecided before its page loads`);
      none.deliver(() => {});
      h.eq([seen, none.tokenAbsent, none.authorized], [[false], true, false], `${name}: the load end settles it as absent, once`);
      none.deliver(() => {});
      const late: boolean[] = [];
      none.whenSettled((authorized) => late.push(authorized));
      h.eq([seen, late], [[false], [false]], `${name}: never again, and a later wait is answered at once`);
    }
  });

  await h.test('channel: the canary is recorded and dropped, and joins the WebView’s exposure record however the two arrive', () => {
    const report = (token: string, payload: object) => signedWith(token, JSON.stringify({ kind: 'bridge-exposure', payload }));
    const navigated = { outcome: 'navigated', visible: { android: true, ios: false }, webview: 'chrome-131' };
    for (const order of ['canary first', 'report first'] as const) {
      const seen: ExposureRecord[] = [];
      const channel = new RuntimeChannel(osRandom(), { exposure: (r) => seen.push(r) });
      let token = '';
      channel.deliver((js) => { token = /auth\('([0-9a-f]{32})'\)/.exec(js)?.[1] ?? ''; });
      const steps = order === 'canary first' ? [EXPOSURE_CANARY, report(token, navigated)] : [report(token, navigated), EXPOSURE_CANARY];
      h.eq(steps.map((raw) => channel.receive(raw)), [null, null], `${order}: neither reaches the consumer`);
      h.eq(channel.snapshot().dropped, 1, `${order}: the canary is dropped and counted`);
      h.eq(channel.snapshot().exposure, { outcome: 'navigated', visible: { android: true, ios: false }, canaryReachedNative: true, webview: 'chrome-131' }, `${order}: one record for the WebView`);
      h.eq(seen.map(exposureCode), order === 'canary first' ? ['navigated:android+canary'] : ['navigated:android', 'navigated:android+canary'], `${order}: what the exposure seam was handed`);
      channel.deliver(() => undefined);
      h.eq([channel.snapshot().canary, channel.snapshot().exposure?.canaryReachedNative, channel.snapshot().dropped], [true, true, 1], `${order}: a repeated load end keeps the record and the canary; the drop count is the WebView’s`);
    }
  });

  await h.test('channel: an exposure report is read only signed, only with an outcome it knows, and an unknown engine is never in the grammar', () => {
    const seen: ExposureRecord[] = [];
    const channel = new RuntimeChannel(osRandom(), { exposure: (r) => seen.push(r) });
    let token = '';
    channel.deliver((js) => { token = /auth\('([0-9a-f]{32})'\)/.exec(js)?.[1] ?? ''; });
    const frame = (payload: object) => JSON.stringify({ kind: 'bridge-exposure', payload });
    channel.receive(frame({ outcome: 'navigated', visible: { android: true, ios: true }, webview: 'webkit' }));
    h.eq([seen.length, channel.snapshot().dropped], [0, 1], 'unsigned: dropped, nothing recorded');
    channel.receive(signedWith(token, frame({ outcome: 'leaked', visible: { android: true, ios: true }, webview: 'webkit' })));
    h.eq(seen.length, 0, 'an outcome outside the three is not a result');
    channel.receive(signedWith(token, frame({ outcome: 'refused', visible: { android: true, ios: true }, webview: 'unknown' })));
    h.eq(seen, [{ outcome: 'refused', visible: { android: false, ios: false }, canaryReachedNative: false, webview: null }],
      'a refusal saw nothing, and an engine outside chrome-<n> | webkit is recorded as none');
  });

  await h.test('channel: only the page’s own report shape is an exposure report; a signed relay of that kind is handed on, never recorded', () => {
    const seen: ExposureRecord[] = [];
    const channel = new RuntimeChannel(osRandom(), { exposure: (r) => seen.push(r) });
    let token = '';
    channel.deliver((js) => { token = /auth\('([0-9a-f]{32})'\)/.exec(js)?.[1] ?? ''; });
    const payload = { outcome: 'navigated', visible: { android: true, ios: true }, webview: 'webkit' };
    for (const relay of [
      { kind: 'bridge-exposure', trusted: true, payload },
      { kind: 'bridge-exposure', payload, trusted: true },
    ]) {
      const body = JSON.stringify(relay);
      h.eq(channel.receive(signedWith(token, body)), body, `${body}: handed to the consumer as it came`);
    }
    h.eq([seen.length, channel.snapshot().exposure], [0, null], 'neither relay shape set or reported an exposure record');
    channel.receive(signedWith(token, JSON.stringify({ kind: 'bridge-exposure', payload })));
    h.eq(seen.length, 1, 'the page’s own shape, signed, is recorded');
  });
}
