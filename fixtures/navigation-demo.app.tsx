// Trail Notes: a list of trails, and a screen for the one tapped. `nav` takes only a screen name,
// so the tapped trail is kept at module level before navigating, and the detail screen's header
// brings its own back control.
import { defineApp, nav, Screen, Stack, Row, List, ListItem, Badge, Text } from 'vc-sdk';

interface Trail {
  id: string;
  name: string;
  length: string;
  level: 'easy' | 'moderate' | 'hard';
  note: string;
}

const TRAILS: Trail[] = [
  { id: 'cedar', name: 'Cedar Loop', length: '4.2 km', level: 'easy', note: 'Shaded forest path with a creek overlook.' },
  { id: 'ridge', name: 'Ridge Walk', length: '7.8 km', level: 'moderate', note: 'Open ridge line; windy after noon.' },
  { id: 'falls', name: 'Falls Climb', length: '5.1 km', level: 'hard', note: 'Steep steps beside the falls. Wet in spring.' },
];

const LEVEL_TONE = { easy: 'positive', moderate: 'warning', hard: 'danger' } as const;

let opened: Trail = TRAILS[0];

function TrailList() {
  return (
    <Screen title="Trail Notes">
      <List
        items={TRAILS}
        keyBy="id"
        renderItem={(trail) => (
          <ListItem
            title={trail.name}
            subtitle={trail.level}
            trailing={trail.length}
            icon="footprints"
            onPress={() => {
              opened = trail;
              nav.navigate('Detail');
            }}
          />
        )}
      />
    </Screen>
  );
}

function TrailDetail() {
  return (
    <Screen title={opened.name}>
      <Stack>
        <Row>
          <Badge label={opened.level} tone={LEVEL_TONE[opened.level]} />
          <Text color="text-muted">{opened.length}</Text>
        </Row>
        <Text>{opened.note}</Text>
      </Stack>
    </Screen>
  );
}

export default defineApp({
  name: 'Trail Notes',
  initial: 'List',
  screens: { List: TrailList, Detail: TrailDetail },
  capabilities: [],
  tint: ['stone', 'slate'],
  icon: 'mountain',
});
