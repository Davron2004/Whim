// ─────────────────────────────────────────────────────────────────────────────
// ADVERSARIAL FIXTURE — the ERROR RAISER (developer-observability task 3.4, owner-authored).
//
// A mini-app in the normal contract shape that paints normally and fails only when tapped:
//   • "Calm"    — a benign handler (the no-error control: a tap alone must not produce an
//                 `error` frame).
//   • "Throw"   — the handler throws a `LedgerError` whose message carries user data. The
//                 loader must report it as a trusted `error` frame, `where: 'runtime'`,
//                 `name: 'LedgerError'`, and none of the message text.
//   • "Reject"  — the handler leaves a `SettleError` rejection unhandled. The loader must report
//                 it as a trusted `error` frame, `where: 'rejection'`, `name: 'SettleError'`, and
//                 none of the message text.
//   • "Forge"   — the bundle posts `error` frames to the host page itself, one with no nonce and
//                 one with a guessed nonce. The host page must reject both as forgeries (F4).
//
// Compiled by the bridge runner (runner.mjs) with the build's app-bundle options; it is not in
// build/build.mjs's APPS, so it never ships in runtime-artifacts or the launcher seed.
// The button labels must never contain the message text: a `press` ui-event carries the label.
// ─────────────────────────────────────────────────────────────────────────────
import { defineApp, Screen, Stack, Heading, Text, Button, useState } from 'vc-sdk';

const w: any = globalThis as any;

class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}
class SettleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettleError';
  }
}

function Home() {
  const [calm, setCalm] = useState(0);
  return (
    <Screen padding="lg">
      <Stack gap="sm">
        <Heading size="title">ERROR RAISER</Heading>
        <Text size="caption">calm taps: {calm}</Text>
        <Button label="Calm" onPress={() => setCalm((n) => n + 1)} />
        <Button
          label="Throw"
          onPress={() => {
            throw new LedgerError('Alice owes 40 for the Lisbon trip');
          }}
        />
        <Button
          label="Reject"
          onPress={() => {
            void Promise.reject(new SettleError('Alice owes 40 for the Lisbon trip'));
          }}
        />
        <Button
          label="Forge"
          onPress={() => {
            const payload = { where: 'runtime', name: 'ForgedError' };
            w.parent.postMessage(JSON.stringify({ __whimHarness: true, kind: 'error', payload }), '*');
            w.parent.postMessage(
              JSON.stringify({ __whimHarness: true, nonce: 'guessed-nonce', kind: 'error', payload }),
              '*',
            );
          }}
        />
      </Stack>
    </Screen>
  );
}

export default defineApp({ name: 'Error Raiser', initial: 'Home', screens: { Home }, capabilities: [] });
