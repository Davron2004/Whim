// Tip Splitter: the bill, a tip from the usual choices and the number of people give each
// person's share. Pure arithmetic, so it declares no capabilities.
import { defineApp, Screen, Stack, Row, Card, Divider, Text, NumberInput, SegmentedControl, Stepper, useState } from 'vc-sdk';

const TIPS = ['10%', '15%', '20%', '25%'];

function Home() {
  const [bill, setBill] = useState(100);
  const [tip, setTip] = useState('20%');
  const [people, setPeople] = useState(2);

  const tipAmount = (bill * Number.parseInt(tip, 10)) / 100;
  const total = bill + tipAmount;
  const money = (n: number) => '$' + n.toFixed(2);

  return (
    <Screen title="Tip Splitter">
      <Stack gap="lg">
        <NumberInput label="Bill" value={bill} min={0} onChange={setBill} />
        <Stack gap="sm">
          <Text color="text-muted">Tip</Text>
          <SegmentedControl options={TIPS} value={tip} onChange={setTip} />
        </Stack>
        <Stepper label="People" value={people} min={1} onChange={setPeople} />
        <Card>
          <Stack>
            <Row justify="between">
              <Text color="text-muted">Tip</Text>
              <Text>{money(tipAmount)}</Text>
            </Row>
            <Row justify="between">
              <Text color="text-muted">Total</Text>
              <Text>{money(total)}</Text>
            </Row>
            <Divider />
            <Row justify="between">
              <Text weight="semibold">Per person</Text>
              <Text size="title" color="primary">{money(total / people)}</Text>
            </Row>
          </Stack>
        </Card>
      </Stack>
    </Screen>
  );
}

export default defineApp({
  name: 'Tip Splitter',
  initial: 'Home',
  screens: { Home },
  capabilities: [],
  tint: ['slate', 'stone'],
  icon: 'receipt',
  // A legacy colour, kept only until the home screen draws `tint`. New apps never declare it.
  tileColor: '#15803d',
});
