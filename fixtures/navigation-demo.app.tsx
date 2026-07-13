// ─────────────────────────────────────────────────────────────────────────────
// navigation-demo — sdk-navigation's list → detail acceptance mini-app.
// ─────────────────────────────────────────────────────────────────────────────
// This is also synthetic-run-harness material: the labels make the initial, pushed, and
// returned states observable without exposing any runtime internals to the mini-app.
import { Button, Card, defineApp, Heading, nav, Screen, Stack, Text } from 'vc-sdk';

function List() {
  return (
    <Screen padding="lg">
      <Stack gap="lg">
        <Heading size="title">Trail Notes</Heading>
        <Text color="text-muted">Choose a saved trail.</Text>
        <Card>
          <Stack gap="sm">
            <Heading size="subtitle">Cedar Loop</Heading>
            <Text>4.2 km · easy</Text>
            <Button label="Open Cedar Loop" onPress={() => nav.navigate('Detail')} />
          </Stack>
        </Card>
      </Stack>
    </Screen>
  );
}

function Detail() {
  return (
    <Screen padding="lg">
      <Stack gap="lg">
        <Heading size="title">Cedar Loop details</Heading>
        <Text>Shaded forest path with a creek overlook.</Text>
        <Button label="Back to trails" variant="secondary" onPress={() => nav.back()} />
      </Stack>
    </Screen>
  );
}

export default defineApp({
  name: 'Trail Notes',
  initial: 'List',
  screens: { List, Detail },
  capabilities: [],
});
