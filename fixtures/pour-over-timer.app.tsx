// ─────────────────────────────────────────────────────────────────────────────
// pour-over-timer — the effects-and-cues v0.3 acceptance mini-app (§15.3: "the pour-over timer
// comes alive"). Hand-written; the agent/server is later.
// ─────────────────────────────────────────────────────────────────────────────
// Imports ONLY from `vc-sdk`. Declares `capabilities: ['cues']` and NO storage (the brew is
// ephemeral). It exercises BOTH timed effects and BOTH cue syscalls:
//   • `interval` — the 1 s staged countdown (bloom → pour → drawdown). Auto-cleanup on unmount
//     and pause-without-teardown via the hook's `running` opt; no syscall frame from the timer.
//   • `delay`    — the 3-2-1 "get ready" beat before brewing (one-shot sequencing).
//   • `cues.haptic('double')` + `cues.sound('chime')` at each stage transition;
//     `cues.haptic('heavy')` + `cues.sound('alarm')` when the brew finishes; a light
//     `cues.haptic('tap')` + `cues.sound('tick')` on each get-ready count.
// Every cue crosses the bridge as a gated, fire-and-forget syscall; the timers never do.
import {
  defineApp,
  Screen,
  Stack,
  Row,
  Heading,
  Text,
  Button,
  useState,
  interval,
  delay,
  cues,
} from 'vc-sdk';

// The canonical pour-over recipe (design D8). Durations are seconds; tune freely — the fixture
// reads them, nothing is hard-coded downstream.
const STAGES: { name: string; secs: number }[] = [
  { name: 'Bloom', secs: 30 },
  { name: 'Pour', secs: 90 },
  { name: 'Drawdown', secs: 45 },
];

type Phase = 'idle' | 'ready' | 'brewing' | 'paused' | 'done';

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function Brew() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [stageIdx, setStageIdx] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [count, setCount] = useState(0); // the 3-2-1 get-ready number

  // The staged 1 s countdown. Called unconditionally (hook rules); it only ticks while brewing,
  // so pausing (phase → 'paused') stops it WITHOUT tearing the component down, and unmounting
  // cancels it with no cleanup written here (design D1). The callback closes over current state —
  // the hook keeps the latest closure, so each tick sees fresh `remaining`/`stageIdx`.
  interval(
    () => {
      if (remaining > 1) {
        setRemaining(remaining - 1);
        return;
      }
      // This stage just elapsed.
      if (stageIdx < STAGES.length - 1) {
        cues.haptic('double'); // stage-transition cue
        cues.sound('chime');
        const next = stageIdx + 1;
        setStageIdx(next);
        setRemaining(STAGES[next].secs);
      } else {
        cues.haptic('heavy'); // the brew is done
        cues.sound('alarm');
        setRemaining(0);
        setPhase('done');
      }
    },
    1000,
    { running: phase === 'brewing' },
  );

  // Start → a 3-2-1 get-ready beat (delay + a light cue per count), then brewing begins. Async in
  // an event handler is fine; the interval is dormant (phase !== 'brewing') during the count.
  const start = async () => {
    setPhase('ready');
    for (const n of [3, 2, 1]) {
      setCount(n);
      cues.sound('tick');
      cues.haptic('tap');
      await delay(1000);
    }
    setStageIdx(0);
    setRemaining(STAGES[0].secs);
    setPhase('brewing');
  };

  const pause = () => setPhase('paused');
  const resume = () => setPhase('brewing');
  const reset = () => {
    setPhase('idle');
    setStageIdx(0);
    setRemaining(0);
    setCount(0);
  };

  const stage = STAGES[stageIdx];
  const big =
    phase === 'ready' ? String(count) :
    phase === 'done' ? 'Done' :
    phase === 'idle' ? `${STAGES.length} stages` :
    mmss(remaining);
  const caption =
    phase === 'idle' ? 'Tap brew to start' :
    phase === 'ready' ? 'Get ready…' :
    phase === 'done' ? 'Enjoy your coffee' :
    `${stage.name}  ·  stage ${stageIdx + 1}/${STAGES.length}${phase === 'paused' ? '  ·  paused' : ''}`;

  return (
    <Screen padding="lg">
      <Stack gap="lg">
        <Heading size="title">Pour-Over Timer</Heading>
        <Text size="caption" color="text-muted">{caption}</Text>

        <Row gap="sm">
          <Text color="text-muted">{phase === 'done' ? 'Total' : 'Remaining'}</Text>
          <Text size="display" color="primary">{big}</Text>
        </Row>

        {phase === 'idle' || phase === 'done' ? (
          <Button label={phase === 'done' ? 'Brew again' : 'Brew'} onPress={phase === 'done' ? () => { reset(); start(); } : start} />
        ) : phase === 'paused' ? (
          <Stack gap="sm">
            <Button label="Resume" onPress={resume} />
            <Button label="Reset" onPress={reset} />
          </Stack>
        ) : (
          <Stack gap="sm">
            <Button label="Pause" onPress={pause} />
            <Button label="Reset" onPress={reset} />
          </Stack>
        )}
      </Stack>
    </Screen>
  );
}

export default defineApp({
  name: 'Pour-Over Timer',
  initial: 'Brew',
  screens: { Brew },
  capabilities: ['cues'],
});
