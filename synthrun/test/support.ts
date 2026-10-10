/**
 * Helpers the synthrun suites share: a run wired the way `report.ts` wires one (observers attached
 * first, capability bridge second, the bridge's traffic counted as activity), and a timeout race so
 * a hang is a failed test and not a hung suite.
 */
import { runStaticChecks } from '../../checks';
import { attachObserversEarly, noteActivity, type AttachedObservers, type EarlyObservers } from '../observe';
import type { RunContext, SynthRunSession } from '../session';
import { wireCapabilityBridge, type CapabilityWiring, type CapabilityWiringOptions } from '../capability';
import type { AppRecord } from '../../src/host/bridge';

/** Rejects with a named message if `work` outlasts `ms`, so a hang is a failed test and not a hung suite. */
export async function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** The `AppRecord` `createRunCandidate` builds for a candidate: its own declared capabilities and
 *  schema, read by the static check. A candidate that declares none gets an empty schema, so
 *  `storage` launches. */
export function appRecordFor(source: string, appId: string): AppRecord {
  const manifest = runStaticChecks(source).manifest;
  return {
    appId,
    name: manifest?.name ?? appId,
    manifest: { capabilities: manifest?.capabilities ?? [] },
    schemaArtifact: (manifest?.schema ?? { schemaVersion: 1, collections: {} }) as AppRecord['schemaArtifact'],
  };
}

export interface WiredRun {
  ctx: RunContext;
  obs: AttachedObservers;
  wiring: CapabilityWiring;
  dispose: () => Promise<void>;
}

/** Opens a run composed as `createRunCandidate` composes one: every observer attached before
 *  navigation, then the capability bridge, whose dispatches and replies count as activity on the
 *  observers' quiet-window clock. */
export async function openWiredRun(session: SynthRunSession, source: string, wiringOptions: CapabilityWiringOptions = {}): Promise<WiredRun> {
  const app = appRecordFor(source, crypto.randomUUID());
  let early: EarlyObservers | undefined;
  const wiring = wireCapabilityBridge(app, {
    ...wiringOptions,
    onActivity: () => {
      if (early) noteActivity(early.state);
    },
  });
  const { ctx, dispose } = await session.openRun(source, {
    appId: app.appId,
    beforeNavigate: async (page, context) => {
      early = await attachObserversEarly(page, context);
      await wiring.beforeNavigate(page, context);
    },
  });
  const obs = await early!.finish(ctx);
  return {
    ctx,
    obs,
    wiring,
    dispose: async () => {
      obs.detach();
      await dispose();
    },
  };
}
