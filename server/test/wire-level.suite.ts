/**
 * server/test/wire-level.suite.ts — protocol-level negotiation on the sending side (beta-1 design
 * D16 layer 2; generation-contract "The client declares the protocol level it understands",
 * scenario "Server adapts to an older client"): the production registry covers every event type and
 * `/v1` error code, every entry above level 1 carries its `compat`, and `eventForLevel` /
 * `errorForLevel` never hand a client a message above the level it declared.
 *
 * Nothing is above level 1 in beta-1, so the helper's adaptation is driven through a synthetic
 * registry: a level-2 event with a lower-level form, one without, and a level-2 error code. The app
 * is driven through the same registry, to show its routes send nothing past the helper.
 */
import {
  DeviceIdError,
  GenerationEvent,
  PROTOCOL_HEADER,
  PROTOCOL_LEVEL,
  ServiceRefusalCode,
  type ApiError,
  type Compat,
} from '@whim/contract';
import { caught, check, eq, section } from './harness';
import { WIRE_REGISTRY, errorForLevel, eventForLevel, type WireEntry, type WireEvent, type WireRegistry } from '../src/wire-level';
import { createApp } from '../src/app';
import { InMemoryUsageStore } from '../src/usage-store';
import type { Pipeline } from '../src/pipeline';

const ETA_COMPAT: Compat = { min: 2, fallback: 'skip', notice: 'Update Whim to see how long the wait is.' };
const LANE_COMPAT: Compat = { min: 3, fallback: 'fail', notice: 'Update Whim to use priority building.' };
const QUOTA_COMPAT: Compat = { min: 2, fallback: 'update', notice: 'Update Whim to keep building apps.' };

/** Levels 1–3: `eta` (2) has a level-1 form (`queued`); `lane` (3) has a level-2 form (`eta`) and,
 *  through it, none at level 1; `pulse` (2) has no lower form at all; `quota_changed` (2) is an
 *  error code with no lower form. */
function syntheticRegistry(overrides: Partial<Record<'eta' | 'lane', WireEntry<WireEvent>>> = {}): WireRegistry {
  return {
    events: {
      ...WIRE_REGISTRY.events,
      eta: {
        level: 2,
        compat: ETA_COMPAT,
        downgrade: (message) => ({ type: 'queued', position: (message as unknown as { position: number }).position }),
      },
      lane: {
        level: 3,
        compat: LANE_COMPAT,
        downgrade: (message) => ({ type: 'eta', position: 1, seconds: (message as unknown as { seconds: number }).seconds }),
      },
      pulse: { level: 2, compat: { min: 2, fallback: 'skip' } },
      ...overrides,
    },
    errors: { ...WIRE_REGISTRY.errors, quota_changed: { level: 2, compat: QUOTA_COMPAT } },
  };
}

const ETA = { type: 'eta', position: 2, seconds: 40 };
const LANE = { type: 'lane', lane: 'priority', seconds: 10 };
const PULSE = { type: 'pulse', beat: 7 };
const QUOTA: ApiError = { error: 'quota_changed', hint: 'Your daily allowance changed.' };

/** Registry entries above level 1 whose `compat` is missing or names another level. */
function compatFindings(registry: WireRegistry): string[] {
  const findings: string[] = [];
  for (const [kind, entries] of [['event', registry.events], ['error', registry.errors]] as const) {
    for (const [name, entry] of Object.entries(entries)) {
      if (entry.level <= 1) continue;
      if (entry.compat === undefined) findings.push(`${kind} ${name}: level ${entry.level} with no compat`);
      else if (entry.compat.min !== entry.level) findings.push(`${kind} ${name}: level ${entry.level} but compat.min ${entry.compat.min}`);
    }
  }
  return findings;
}

/** The registered level of what a client received, or `'envelope'` when it got only the envelope. */
function receivedLevel(registry: WireRegistry, message: WireEvent): number | 'envelope' {
  const keys = Object.keys(message).sort((a, b) => a.localeCompare(b));
  if (keys.join(',') === 'compat,type') return 'envelope';
  return registry.events[message.type].level;
}

function testProductionRegistry(): void {
  section('Wire level — the production registry');
  const arms = GenerationEvent.options.map((arm) => arm.shape.type.value).sort((a, b) => a.localeCompare(b));
  eq('every GenerationEvent type is registered, and nothing else', Object.keys(WIRE_REGISTRY.events).sort((a, b) => a.localeCompare(b)), arms);
  const codes = [...ServiceRefusalCode.options, ...DeviceIdError.shape.error.options];
  eq('every refusal and device-identity code is registered', codes.filter((code) => !(code in WIRE_REGISTRY.errors)), []);
  eq('every entry above level 1 carries compat whose min is its level', compatFindings(WIRE_REGISTRY), []);
  eq(
    'the compat check names an entry above level 1 with no compat, and one whose min is off',
    compatFindings(syntheticRegistry({ eta: { level: 2 }, lane: { level: 3, compat: ETA_COMPAT } })),
    ['event eta: level 2 with no compat', 'event lane: level 3 but compat.min 2'],
  );
  const aboveServer = Object.entries({ ...WIRE_REGISTRY.events, ...WIRE_REGISTRY.errors }).filter(([, entry]) => entry.level > PROTOCOL_LEVEL);
  eq('no registered message is above the contract’s own level', aboveServer.map(([name]) => name), []);
}

async function testAdaptation(): Promise<void> {
  section('Wire level — a client never receives a message above its level');
  const registry = syntheticRegistry();
  const queued: GenerationEvent = { type: 'queued', position: 4 };
  eq('a level-1 event reaches a level-1 client unchanged', eventForLevel(queued, 1), queued);
  const tooLong: ApiError = { error: 'payload_too_large', hint: 'Try a shorter description.' };
  eq('a level-1 error reaches a level-1 client unchanged', errorForLevel(tooLong, 1), tooLong);

  eq('a level-2 client gets the level-2 event, with its compat attached', eventForLevel(ETA, 2, registry), { ...ETA, compat: ETA_COMPAT });
  eq('a level-1 client gets its lower-level form instead', eventForLevel(ETA, 1, registry), { type: 'queued', position: 2 });
  eq('with no lower form, a level-1 client gets only the envelope', eventForLevel(PULSE, 1, registry), { type: 'pulse', compat: { min: 2, fallback: 'skip' } });
  eq('a lower form that is itself above the client is not sent: only the envelope', eventForLevel(LANE, 1, registry), { type: 'lane', compat: LANE_COMPAT });
  eq('a level-2 client gets the level-2 form of a level-3 event', eventForLevel(LANE, 2, registry), { type: 'eta', position: 1, seconds: 10, compat: ETA_COMPAT });
  eq('a level-2 error code reaches a level-1 client as its envelope', errorForLevel(QUOTA, 1, registry), { ...QUOTA, compat: QUOTA_COMPAT });
  eq('and a level-2 client with its compat', errorForLevel(QUOTA, 2, registry), { ...QUOTA, compat: QUOTA_COMPAT });

  for (const clientLevel of [1, 2, 3]) {
    for (const message of [queued, ETA, LANE, PULSE]) {
      const received = receivedLevel(registry, eventForLevel(message, clientLevel, registry));
      check(`a level-${clientLevel} client receives "${message.type}" at or below its level, or as an envelope`, received === 'envelope' || received <= clientLevel, String(received));
    }
  }

  const unregistered = await caught(() => {
    eventForLevel({ type: 'mystery' }, 1);
  });
  check('an unregistered event is refused rather than sent', unregistered instanceof Error && unregistered.message.includes('mystery'));
  const bare = await caught(() => {
    eventForLevel(LANE, 1, syntheticRegistry({ lane: { level: 3 } }));
  });
  check('an entry above the client with no compat is refused rather than sent bare', bare instanceof Error && bare.message.includes('lane'));
}

const DEVICE_ID = '33333333-3333-4333-8333-333333333333';

/** A pipeline whose run yields `events` as they are, level-2 ones included. */
function pipelineOf(events: readonly WireEvent[]): Pipeline {
  return {
    async *run() {
      for (const event of events) yield event as GenerationEvent;
    },
  };
}

/** A `/v1` POST from a client that declares `level`. */
async function postAt(app: ReturnType<typeof createApp>, path: string, body: unknown, level: number): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-whim-device': DEVICE_ID, [PROTOCOL_HEADER]: String(level) },
    body: JSON.stringify(body),
  });
}

/** Every `data:` payload of an SSE response, parsed as plain JSON, frames outside `GenerationEvent`
 *  included. */
async function sseData(response: Response): Promise<Record<string, unknown>[]> {
  const text = await response.text();
  return text
    .split(/\n\n+/)
    .flatMap((block) => block.split('\n').filter((line) => line.startsWith('data: ')))
    .map((line) => JSON.parse(line.slice('data: '.length)) as Record<string, unknown>);
}

async function testRoutesSendAtTheClientsLevel(): Promise<void> {
  section('Wire level — the generate route’s events and every /v1 error body go out at the request’s level');
  const stage: GenerationEvent = { type: 'stage', stage: 'plan', status: 'start' };
  const result: GenerationEvent = { type: 'result', app: { name: 'demo', source: 's', bundle: 'b', manifest: {}, schema: {} } };
  const invalidCompat: Compat = { min: 2, fallback: 'update', notice: 'Update Whim to send this.' };
  const synthetic = syntheticRegistry();
  // `invalid_request` re-registered at level 2, to watch a route's own error body go out.
  const wireRegistry: WireRegistry = { events: synthetic.events, errors: { ...synthetic.errors, invalid_request: { level: 2, compat: invalidCompat } } };
  const app = createApp({ pipeline: pipelineOf([stage, ETA, PULSE, result]), usageStore: new InMemoryUsageStore(), wireRegistry });

  const levelOne = await sseData(await postAt(app, '/v1/generate', { prompt: 'a tip splitter' }, 1));
  eq(
    'a level-1 client gets a level-2 pipeline event as its lower form, and one with none as its envelope',
    levelOne.slice(1, 3),
    [{ type: 'queued', position: 2 }, { type: 'pulse', compat: { min: 2, fallback: 'skip' } }],
  );
  eq('  ... and the level-1 events around them as they are', [levelOne[0], levelOne.at(-1)?.type], [stage, 'result']);
  const levelTwo = await sseData(await postAt(app, '/v1/generate', { prompt: 'a tip splitter' }, 2));
  eq('a level-2 client gets both in full, with their compat', levelTwo.slice(1, 3), [{ ...ETA, compat: ETA_COMPAT }, { ...PULSE, compat: { min: 2, fallback: 'skip' } }]);

  const refused = await postAt(app, '/v1/generate', { notAPrompt: true }, 1);
  const body = (await refused.json()) as Record<string, unknown>;
  eq('a route’s own error body reaches a level-1 client with its level-2 entry’s compat', [refused.status, body.error, body.compat], [400, 'invalid_request', invalidCompat]);
}

export async function runWireLevelTests(): Promise<void> {
  testProductionRegistry();
  await testAdaptation();
  await testRoutesSendAtTheClientsLevel();
}
