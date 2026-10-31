/**
 * useHomeLive — Home's sampled view of the running attempts (`home-live.ts`): re-read about once a
 * second while Home is the screen, and only re-rendered when something it shows changed.
 */
import { useEffect, useRef, useState } from 'react';
import { NO_LIVE_VIEW, sameLiveView, sampleLive, type LiveSample, type LiveSignals, type LiveView } from './home-live';
import { RUN_SIGNAL_TICK_MS } from './prompt-flow';

export function useHomeLive(active: boolean, attempts: () => readonly { id: string; signals: LiveSignals }[]): LiveView {
  const samples = useRef(new Map<string, LiveSample>()).current;
  const read = useRef(attempts);
  read.current = attempts;
  const [view, setView] = useState<LiveView>(NO_LIVE_VIEW);
  useEffect(() => {
    if (!active) return undefined;
    const sample = () => {
      const next = sampleLive(read.current(), samples, Date.now());
      setView((prev) => (sameLiveView(prev, next) ? prev : next));
    };
    sample();
    const timer = setInterval(sample, RUN_SIGNAL_TICK_MS);
    return () => clearInterval(timer);
  }, [active, samples]);
  return view;
}
