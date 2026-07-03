// ─────────────────────────────────────────────────────────────────────────────
// style-gallery — the sdk-design-system acceptance mini-app (design D9).
// ─────────────────────────────────────────────────────────────────────────────
// One screen, one file, imports ONLY from `vc-sdk`, `capabilities: []` (Tier-0, zero
// syscalls — this fixture is manual QA + a knip anchor, not a data app). It exercises every
// component controls.tsx/surfaces.tsx add, plus the new `Button` variants and `Row`
// align/justify props, laid out the way a designer would use them: one `Card` per section.
import {
  defineApp,
  Screen,
  Stack,
  Row,
  Heading,
  Text,
  NumberInput,
  Button,
  useState,
  TextInput,
  Switch,
  Checkbox,
  Slider,
  SegmentedControl,
  Card,
  Divider,
  Spacer,
  Grid,
  Badge,
  ProgressBar,
  List,
  ListItem,
  EmptyState,
  Modal,
} from 'vc-sdk';

function Home() {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState(42);
  const [progress, setProgress] = useState(50);
  const [notify, setNotify] = useState(true);
  const [agree, setAgree] = useState(false);
  const [range, setRange] = useState('Week');
  const [showList, setShowList] = useState(true);
  const [starred, setStarred] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <Screen padding="lg">
      <Stack gap="lg">
        <Heading size="display">Style Gallery</Heading>

        <Card>
          <Stack gap="md">
            <Heading size="subtitle">Type</Heading>
            <Heading size="subtitle">Subtitle heading</Heading>
            <Heading size="title">Title heading</Heading>
            <Text size="body">Body text, the default paragraph size.</Text>
            <Text size="caption" color="text-muted">Caption text, muted.</Text>
            <Text align="center">Centered text sample.</Text>
          </Stack>
        </Card>

        <Card>
          <Stack gap="md">
            <Heading size="subtitle">Buttons</Heading>
            <Row gap="sm" justify="start">
              <Button label="Primary" variant="primary" />
              <Button label="Secondary" variant="secondary" />
              <Button label="Ghost" variant="ghost" />
              <Button label="Danger" variant="danger" />
              <Button label="Disabled" disabled />
            </Row>
          </Stack>
        </Card>

        <Card>
          <Stack gap="md">
            <Heading size="subtitle">Inputs</Heading>
            <TextInput label="Name" value={name} placeholder="Type here" onChange={setName} />
            <Text size="caption" color="text-muted">Echo: {name || '(empty)'}</Text>
            <NumberInput label="Amount" value={amount} min={0} onChange={setAmount} />
            <Slider label="Progress" value={progress} min={0} max={100} onChange={setProgress} />
            <ProgressBar value={progress / 100} />
            <Switch label="Notifications" value={notify} onChange={setNotify} />
            <Checkbox label="I agree" checked={agree} onChange={setAgree} />
            <Row gap="sm" align="center">
              <SegmentedControl options={['Day', 'Week', 'Month']} value={range} onChange={setRange} />
              <Badge label={range} tone="primary" />
            </Row>
          </Stack>
        </Card>

        <Card>
          <Stack gap="md">
            <Heading size="subtitle">Badges</Heading>
            <Row gap="sm" justify="start">
              <Badge label="Neutral" tone="neutral" />
              <Badge label="Primary" tone="primary" />
              <Badge label="Positive" tone="positive" />
              <Badge label="Warning" tone="warning" />
              <Badge label="Danger" tone="danger" />
            </Row>
          </Stack>
        </Card>

        <Card>
          <Stack gap="md">
            <Row justify="between" align="center">
              <Heading size="subtitle">List</Heading>
              <Switch label="Show" value={showList} onChange={setShowList} />
            </Row>
            {showList ? (
              <List>
                <ListItem title="First item" subtitle="With a subtitle" />
                <ListItem title="Second item" trailing="12" />
                <ListItem
                  title={starred ? 'Starred ★' : 'Tap to star'}
                  onPress={() => setStarred((s) => !s)}
                />
              </List>
            ) : (
              <EmptyState title="Nothing here" hint="Toggle Show to bring the list back" />
            )}
          </Stack>
        </Card>

        <Card>
          <Stack gap="md">
            <Heading size="subtitle">Layout</Heading>
            <Grid columns={2}>
              <Card padding="sm">
                <Text align="center">A</Text>
              </Card>
              <Card padding="sm">
                <Text align="center">B</Text>
              </Card>
              <Card padding="sm">
                <Text align="center">C</Text>
              </Card>
              <Card padding="sm">
                <Text align="center">D</Text>
              </Card>
            </Grid>
            <Divider />
            <Row>
              <Text>Left</Text>
              <Spacer />
              <Text>Right</Text>
            </Row>
          </Stack>
        </Card>

        <Card>
          <Stack gap="md">
            <Heading size="subtitle">Modal</Heading>
            <Button label="Open modal" variant="secondary" onPress={() => setModalOpen(true)} />
          </Stack>
        </Card>

        <Modal visible={modalOpen} title="Details" onClose={() => setModalOpen(false)}>
          <Stack gap="md">
            <Text>This modal demonstrates the sheet surface.</Text>
            <Button label="Close" onPress={() => setModalOpen(false)} />
          </Stack>
        </Modal>
      </Stack>
    </Screen>
  );
}

export default defineApp({
  name: 'Style Gallery',
  initial: 'Home',
  screens: { Home },
  capabilities: [], // Tier-0: manual QA / knip anchor, zero syscalls
});
