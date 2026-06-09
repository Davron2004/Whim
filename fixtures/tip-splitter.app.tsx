// ─────────────────────────────────────────────────────────────────────────────
// tip-splitter — the v0.1 acceptance mini-app (hand-written; the agent/server is later).
// ─────────────────────────────────────────────────────────────────────────────
// The whole contract in one file: imports ONLY from `vc-sdk`, a single
// `export default defineApp({...})`, and `capabilities: []` — Tier-0, pure compute +
// rendering, ZERO syscalls (v0.1 has no bridge by design). esbuild bundles this to a single
// IIFE; the trusted loader delivers + mounts it inside the contained iframe (channel b).
import { defineApp, Screen, Stack, Row, Heading, Text, NumberInput, Button, useState } from 'vc-sdk';

function Home() {
  const [bill, setBill] = useState(100);
  const [tipPct, setTipPct] = useState(20);
  const [people, setPeople] = useState(4);

  const safePeople = people < 1 ? 1 : people;
  const tip = bill * (tipPct / 100);
  const total = bill + tip;
  const perPerson = total / safePeople;
  const money = (n: number) => '$' + (Math.round(n * 100) / 100).toFixed(2);

  return (
    <Screen padding="lg">
      <Stack gap="lg">
        <Heading size="title">Tip Splitter</Heading>

        <NumberInput label="Bill" value={bill} min={0} onChange={setBill} />
        <NumberInput label="Tip %" value={tipPct} min={0} onChange={setTipPct} />
        <NumberInput label="People" value={people} min={1} onChange={setPeople} />

        <Stack gap="sm">
          <Row gap="sm">
            <Text color="text-muted">Tip</Text>
            <Text>{money(tip)}</Text>
          </Row>
          <Row gap="sm">
            <Text color="text-muted">Total</Text>
            <Text>{money(total)}</Text>
          </Row>
          <Row gap="sm">
            <Text color="text-muted">Per person</Text>
            <Text size="subtitle" color="primary">{money(perPerson)}</Text>
          </Row>
        </Stack>

        <Button
          label="Reset"
          radius="md"
          onPress={() => {
            setBill(0);
            setTipPct(20);
            setPeople(1);
          }}
        />
      </Stack>
    </Screen>
  );
}

export default defineApp({
  name: 'Tip Splitter',
  initial: 'Home',
  screens: { Home },
  capabilities: [], // Tier-0: pure compute + rendering, zero syscalls
});
