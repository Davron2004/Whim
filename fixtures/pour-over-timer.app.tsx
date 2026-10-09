// Pour-Over Timer: a 3-2-1 count, then a timed bloom, pour and drawdown, with a tap and tick on
// each count, a buzz and chime between stages and a heavier alarm at the end.
import { defineApp, Screen, Stack, Row, Text, Button, ProgressBar, useState, useRef, interval, delay, cues } from 'vc-sdk';

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

function Controls({ phase, onStart, onPause, onResume, onReset }: {
  phase: Phase;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
}) {
  if (phase === 'idle') return <Button label="Brew" icon="coffee" onPress={onStart} />;
  if (phase === 'done') return <Button label="Brew again" icon="coffee" onPress={onStart} />;
  return (
    <Row>
      {phase === 'paused' ? <Button label="Resume" onPress={onResume} /> : <Button label="Pause" onPress={onPause} />}
      <Button label="Reset" variant="secondary" onPress={onReset} />
    </Row>
  );
}

function Brew() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [stageIdx, setStageIdx] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [count, setCount] = useState(0);

  // Each start takes a new run number, and pause or reset bumps it, so a 3-2-1 count still
  // waiting on `delay` sees the change and stops. A ref, because the waiting code reads it live.
  const runId = useRef(0);

  interval(
    () => {
      if (remaining > 1) {
        setRemaining(remaining - 1);
        return;
      }
      if (stageIdx < STAGES.length - 1) {
        cues.haptic('double');
        cues.sound('chime');
        const next = stageIdx + 1;
        setStageIdx(next);
        setRemaining(STAGES[next].secs);
      } else {
        cues.haptic('heavy');
        cues.sound('alarm');
        setRemaining(0);
        setPhase('done');
      }
    },
    1000,
    { running: phase === 'brewing' },
  );

  const start = async () => {
    const myRun = ++runId.current;
    setPhase('ready');
    for (const n of [3, 2, 1]) {
      setCount(n);
      cues.sound('tick');
      cues.haptic('tap');
      await delay(1000);
      if (runId.current !== myRun) return;
    }
    setStageIdx(0);
    setRemaining(STAGES[0].secs);
    setPhase('brewing');
  };
  const pause = () => {
    runId.current++;
    setPhase('paused');
  };
  const reset = () => {
    runId.current++;
    setPhase('idle');
    setStageIdx(0);
    setRemaining(0);
    setCount(0);
  };

  const stage = STAGES[stageIdx];
  const running = phase === 'brewing' || phase === 'paused';
  let reading = mmss(remaining);
  let caption = `${stage.name} · stage ${stageIdx + 1} of ${STAGES.length}${phase === 'paused' ? ' · paused' : ''}`;
  if (phase === 'idle') {
    reading = `${STAGES.length} stages`;
    caption = 'Tap Brew to start';
  } else if (phase === 'ready') {
    reading = String(count);
    caption = 'Get ready…';
  } else if (phase === 'done') {
    reading = 'Done';
    caption = 'Enjoy your coffee';
  }

  return (
    <Screen title="Pour-Over Timer">
      <Stack gap="lg">
        <ProgressBar variant="ring" value={running ? 1 - remaining / stage.secs : Number(phase === 'done')} label={reading} />
        <Text color="text-muted" align="center">{caption}</Text>
        <Controls phase={phase} onStart={start} onPause={pause} onResume={() => setPhase('brewing')} onReset={reset} />
      </Stack>
    </Screen>
  );
}

export default defineApp({
  name: 'Pour-Over Timer',
  initial: 'Brew',
  screens: { Brew },
  capabilities: ['cues'],
  tint: ['stone', 'berry'],
  icon: 'coffee',
});
