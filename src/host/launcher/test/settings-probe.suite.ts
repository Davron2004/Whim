/** The address save's debounce, against a manual timer. */
import { Harness } from './harness';
import { DebouncedSave } from '../settings-probe';
import { FakeTimers } from './fake-timers';

export async function runSettingsProbeTests(h: Harness): Promise<void> {
  // ── DebouncedSave: really run, against a fake clock ─────────────────────────

  await h.test('DebouncedSave: saves once, 600ms after the last edit; flush saves now; cancel drops the edit', async () => {
    const timers = new FakeTimers();
    const saved: string[] = [];
    const save = new DebouncedSave({ save: (value) => saved.push(value), timers });

    for (const value of ['localhost:', 'localhost:8', 'localhost:8787']) save.edit(value);
    h.eq([saved, timers.delays, timers.pendingCount], [[], [600, 600, 600], 1], 'every edit restarts the one 600ms wait; nothing is saved yet');
    timers.fireOnly();
    h.eq(saved, ['localhost:8787'], 'the pause saves the latest edit, once');

    save.edit('localhost:9');
    save.flush();
    h.eq([saved.at(-1), timers.pendingCount], ['localhost:9', 0], 'flush saves at once and clears the wait');
    save.flush();
    h.eq(saved.length, 2, 'a flush with nothing held saves nothing');

    save.edit('localhost:90');
    save.cancel();
    save.flush();
    h.eq([saved.length, timers.pendingCount], [2, 0], 'a cancelled edit is never saved');
  });
}
