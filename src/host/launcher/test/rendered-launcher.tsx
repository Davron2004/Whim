/** A rendered `LauncherRoot` over in-memory native storage and a scripted server, for tests that
 *  drive the real shell the way a user does. The server is a `fetch` stub: every request is
 *  recorded with its parsed body and abort signal, and the test decides each response. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import LauncherRoot from '../LauncherRoot';
import HomeScreen from '../HomeScreen';
import ComposeStep from '../ComposeStep';
import PlanStep from '../PlanStep';
import { AppIndex, type InstalledApp } from '../app-index';
import { grantConsent } from '../ai-consent';
import { createMmkvBackend } from '../../version-store/fs/mmkv-backend';
import type { KVBackend } from '../../version-store/fs/kv-fs';
import { SEED_VERSION } from '../seed';
import { APP_BUNDLES } from '../../../runtime/generated/app-bundles';
import { APP_RECORDS } from '../../../runtime/generated/app-records';
import type { AppInfo } from '../app-info';
import { resetNativeStorage } from './native-storage';
import { captureTimeouts, renderScreen, unmountScreen } from './react-screen';
import { testAppInfo } from './client-fixtures';

export type Tree = TestRenderer.ReactTestRenderer;

export interface SentRequest {
  path: string;
  body: Record<string, unknown> | null;
  signal: AbortSignal | undefined;
  headers: Headers;
}

export interface LauncherSetup {
  /** Installed apps put into the index before the shell mounts. */
  apps?: InstalledApp[];
  /** Launch as a first run, so the shell installs its example apps itself (default false). */
  examples?: boolean;
  /** Grant AI-data consent before mounting (default true). */
  consent?: boolean;
  /** Any other persisted state the shell should find at launch. */
  prepare?: (kv: KVBackend) => void;
  /** The installed app's info reader the shell builds its envelope from (default `testAppInfo`). */
  appInfo?: () => AppInfo;
  /** Answers the connectivity probe's `/healthz` (default: healthy, with no `minBuild`). */
  healthz?: () => Response | Promise<Response>;
  /** Answers every request except `/healthz`. */
  server: (request: SentRequest) => Response | Promise<Response>;
}

export interface Launcher {
  tree: Tree;
  kv: KVBackend;
  sent: SentRequest[];
  /** The headers of every `/healthz` probe, in order. */
  probes: Headers[];
  paths: () => string[];
  /** Every `setTimeout` is held here instead of scheduled (connect timeouts, probe retries). */
  clock: ReturnType<typeof captureTimeouts>;
}

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A `/v1/generate` response whose events the test pushes one at a time. Aborting the request
 *  errors the body, as a real fetch does. */
export function sseStream(signal?: AbortSignal) {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let open = true;
  const body = new ReadableStream<Uint8Array>({ start: (c) => { controller = c; } });
  signal?.addEventListener('abort', () => {
    if (!open) return;
    open = false;
    controller.error(new DOMException('The operation was aborted.', 'AbortError'));
  });
  return {
    response: new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
    /** Send one event; a stream already ended or aborted takes nothing more. */
    push: (event: unknown) => { if (open) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); },
    end: () => { if (open) { open = false; controller.close(); } },
  };
}

/** A terminal `result` event carrying a real build output (the tip-splitter fixture's host record
 *  and compiled bundle), as the server would stream it. Tip Splitter declares no storage, so its
 *  schema is empty. */
export function resultEvent(name = 'Tip Splitter') {
  const record = APP_RECORDS['tip-splitter'];
  return {
    type: 'result',
    app: { name, source: 'export default {}', bundle: APP_BUNDLES['tip-splitter'], manifest: record.manifest, schema: { collections: [] } },
  };
}

/** Let queued promise work (stream reads, store writes) settle inside React's act. */
export async function settle(rounds = 20): Promise<void> {
  await TestRenderer.act(async () => {
    for (let i = 0; i < rounds; i++) await new Promise<void>((resolve) => setImmediate(resolve));
  });
}

/** Yield to queued work inside React's act until `ready()` holds. Bounded by a wall-clock deadline
 *  (timers are captured, so no timer can bound it): a condition that never comes true fails the
 *  test by name instead of hanging the suite. */
export async function waitFor(ready: () => boolean, what: string, deadlineMs = 5000): Promise<void> {
  const until = Date.now() + deadlineMs;
  while (!ready()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await TestRenderer.act(async () => { await new Promise<void>((resolve) => setImmediate(resolve)); });
  }
}

export async function withLauncher(setup: LauncherSetup, body: (launcher: Launcher) => Promise<void>): Promise<void> {
  resetNativeStorage();
  const kv = createMmkvBackend('whim.launcher');
  const index = new AppIndex(kv);
  if (!setup.examples) index.markSeeded(SEED_VERSION);
  for (const app of setup.apps ?? []) index.put(app);
  if (setup.consent !== false) grantConsent(kv, '2026-09-18T12:00:00.000Z');
  setup.prepare?.(kv);
  const clock = captureTimeouts();
  const originalFetch = globalThis.fetch;
  const sent: SentRequest[] = [];
  const probes: Headers[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (path === '/healthz') {
      probes.push(new Headers(init?.headers));
      return setup.healthz ? setup.healthz() : json({ service: 'whim-server' });
    }
    const request: SentRequest = {
      path,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      signal: init?.signal ?? undefined,
      headers: new Headers(init?.headers),
    };
    sent.push(request);
    return setup.server(request);
  }) as typeof fetch;
  let tree: Tree | undefined;
  try {
    tree = await renderScreen(<LauncherRoot appInfo={setup.appInfo ?? testAppInfo} />);
    await body({ tree, kv, sent, probes, paths: () => sent.map((r) => r.path), clock });
  } finally {
    if (tree) await unmountScreen(tree);
    globalThis.fetch = originalFetch;
    clock.restore();
  }
  const failed = rejections.splice(0);
  if (failed.length > 0) throw new Error(`a handler the test tapped rejected: ${String(failed[0])}`);
}

/** Rejections from handlers the test started without awaiting (a request that stays open, a
 *  stream that runs until the test ends it). The shell catches its own failures, so any rejection
 *  here is a bug, and `withLauncher` fails the test with it. */
const rejections: unknown[] = [];

/** Call a screen's async handler the way a tap does: inside act, without waiting for it. */
export async function tap(handler: () => unknown): Promise<void> {
  await TestRenderer.act(async () => {
    Promise.resolve(handler()).catch((err: unknown) => { rejections.push(err); });
  });
}

/** Home → compose → type → Continue: the clarify exchange is sent. */
export async function composeAndContinue(tree: Tree, text: string): Promise<void> {
  await TestRenderer.act(async () => tree.root.findByType(HomeScreen).props.onCreate());
  await TestRenderer.act(async () => tree.root.findByType(ComposeStep).props.onChangeText(text));
  await tap(() => tree.root.findByType(ComposeStep).props.onContinue());
}

/** Tap the plan's `Build it` without awaiting the attempt (it runs until the stream ends). */
export async function buildIt(tree: Tree): Promise<void> {
  await tap(() => tree.root.findByType(PlanStep).props.onBuild());
}

/** The plan step is showing, with its rows loaded. */
export function planLoaded(tree: Tree): boolean {
  const plan = tree.root.findAllByType(PlanStep);
  return plan.length === 1 && !plan[0].props.loading;
}

/** Home lists an installed app with this name. */
export function hasInstalled(tree: Tree, name: string): boolean {
  return tree.root.findByType(HomeScreen).props.apps.some((app: InstalledApp) => app.name === name);
}

/** A request to this path was sent. */
export function wasSent(sent: readonly SentRequest[], path: string): boolean {
  return sent.some((request) => request.path === path);
}
