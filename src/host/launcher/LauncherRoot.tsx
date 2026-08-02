// ─────────────────────────────────────────────────────────────────────────────
// LauncherRoot — the product shell's top-level screen switch (launcher-shell / #5 D6).
// ─────────────────────────────────────────────────────────────────────────────
// Plain RN state, no navigation library (three screens + a dev flip don't justify the dep): home
// grid → full-screen mini-app → back to home; a __DEV__ entry reaches the containment/bridge
// probe; a settings entry reaches the theme picker. The prompt flow (prompt-flow-ux) adds four
// more screens — prompt → rewrite-preview → generating → (app | failure) — with all async
// orchestration (rewrite call, SSE loop, abort wiring, delivery routing) living here, exactly
// like the existing `onFork`/`onDelete` handlers (design D1). This is also the host wiring: the
// MMKV-backed installed-apps index, the persistent version store, the sanctioned StoreAccess
// path (with the device user-data delete), first-run seeding (D7), the fork/delete flows (D2),
// the theme state (design sdk-design-system D7), and the persisted device id + server address
// (prompt-flow-ux D2/D3) — the pref/id/address are all loaded once from the same `whim.launcher`
// KVBackend the installed-apps index uses. One WebView == one realm == one app: launching reads
// the active bundle source from the record and hands it to MiniAppView (keyed by launcher id, so
// each launch is a fresh realm).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { GenerationEvent, WireAppRecord } from '@whim/contract';
import { APP_RECORDS } from '../../runtime/generated/app-records';
import { APP_BUNDLES } from '../../runtime/generated/app-bundles';
import type { AppManifest, AppRecord } from '../bridge';
import type { SchemaArtifact } from '../storage-engine';
import { createPersistentStore } from '../version-store';
import { createMmkvBackend } from '../version-store/fs/mmkv-backend';
import type { KVBackend } from '../version-store/fs/kv-fs';
import { deleteStorage, peekAppliedSchema } from '../storage-engine';
import { AppIndex, InstalledApp } from './app-index';
import { StoreAccess } from './store-access';
import { buildGenerateRequest } from './generation-request';
import { seedFirstRun, SeedSpec } from './seed';
import HomeScreen from './HomeScreen';
import MiniAppView from './MiniAppView';
import DevProbeScreen from './DevProbeScreen';
import SettingsScreen from './SettingsScreen';
import HistoryScreen from './HistoryScreen';
import PromptScreen from './PromptScreen';
import RewritePreviewScreen from './RewritePreviewScreen';
import GeneratingScreen from './GeneratingScreen';
import FailureScreen from './FailureScreen';
import { shellPalette } from './theme';
import { ThemeProvider, useTheme } from './theme-context';
import { loadServerUrl, saveServerUrl } from './server-address';
import { loadHighlighting, saveHighlighting } from './highlighting';
import { getDeviceId } from './device-id';
import { GenerationClientError, generateApp, rewritePrompt } from './generation-client';
import type { ClientOptions } from './generation-client';
import { isAtTip } from './history-logic';

/** The `stage` event's `stage` field (`GenerationEvent` is a discriminated union). */
type Stage = Extract<GenerationEvent, { type: 'stage' }>['stage'];

type Screen =
  | { kind: 'home' }
  | { kind: 'app'; app: InstalledApp; record: AppRecord; source: string; engineAppId: string }
  | { kind: 'dev' }
  | { kind: 'settings' }
  | { kind: 'history'; app: InstalledApp }
  // prompt-flow-ux (design D1). `editing` absent = new-app flow (home tile); present = the
  // per-app "Prompt again" edit flow. `initialText` seeds the prompt input on re-entry — the
  // failure screen's "rephrase" and the generating screen's cancel both preserve the user's text
  // this way (PromptScreenProps already documents this exact use, prompt-flow-screens handoff).
  | { kind: 'prompt'; editing?: InstalledApp; initialText?: string }
  | { kind: 'rewrite-preview'; editing?: InstalledApp; originalPrompt: string; rewrittenPrompt: string }
  | { kind: 'generating'; editing?: InstalledApp; prompt: string; stage: Stage | null }
  | { kind: 'failure'; editing?: InstalledApp; prompt: string; reason: string; diagnostics: readonly { hint: string }[] };

const GENERIC_STREAM_ERROR = "Something went wrong while building your app. Please try again.";

/** The first-run example set, built from the generated host records + bundle sources (D7). */
function defaultSeeds(): SeedSpec[] {
  const seeds: Array<{ id: string; name: string; prompt: string }> = [
    { id: 'tip-splitter', name: 'Tip Splitter', prompt: 'Example: split a bill with tip' },
    { id: 'water-counter', name: 'Water Counter', prompt: 'Example: track glasses of water' },
    { id: 'style-gallery', name: 'Style Gallery', prompt: 'Example: every SDK component in one screen' },
  ];
  return seeds
    .filter(s => APP_RECORDS[s.id] && APP_BUNDLES[s.id])
    .map(s => ({ ...s, record: APP_RECORDS[s.id], bundleSource: APP_BUNDLES[s.id] }));
}

/** Wraps the approved prompt text in the `{v:1,text}` envelope every delivered generation's
 *  snapshot tracks (spec "structured prompt envelope"; matches `prompt-envelope.ts`'s
 *  `parsePromptEnvelope` expected shape, unchanged). */
function envelope(text: string): string {
  return JSON.stringify({ v: 1, text });
}

/** A fresh, sufficiently-unique launcher id for a brand-new install. Not a security-sensitive
 *  value (only used as a local index/store key), so a timestamp+random string is enough — no new
 *  dependency, mirrors `StoreAccess.fork`'s own cheap id construction in spirit. */
function freshAppId(): string {
  // eslint-disable-next-line sonarjs/pseudo-random -- local id only, not security-sensitive
  return `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Maps a `result` event's wire app record into the host-held `AppRecord` `install`/`update`
 *  expect (design D5 "record: <mapped from wire>"). The wire's `manifest`/`schema` only need to
 *  round-trip on the wire (`ManifestShape`/`SchemaShape` are generic records) — they are
 *  structurally the same shapes `AppManifest`/`SchemaArtifact` describe, matching every fixture
 *  `APP_RECORDS` already ships. `schemaArtifact` is omitted entirely when the wire schema has no
 *  keys, the same "only when the app actually declares storage" convention every other record in
 *  `app-records.ts` follows. */
function mapWireRecord(appId: string, wire: WireAppRecord): AppRecord {
  const hasSchema = Object.keys(wire.schema).length > 0;
  return {
    appId,
    name: wire.name,
    manifest: wire.manifest as unknown as AppManifest,
    ...(hasSchema ? { schemaArtifact: wire.schema as unknown as SchemaArtifact } : {}),
  };
}

/** Maps a thrown error from `rewritePrompt`/`generateApp` down to the failure screen's honest
 *  `{reason, diagnostics}` shape — never the raw error kind/status, matching the "failure shown
 *  honestly" requirement's hint-only discipline (diagnostics stay empty here; only a terminal
 *  `failure` event ever carries real per-diagnostic hints). */
function errorReason(err: unknown): { reason: string; diagnostics: readonly { hint: string }[] } {
  if (err instanceof GenerationClientError && err.hint) {
    return { reason: err.hint, diagnostics: [] };
  }
  return { reason: GENERIC_STREAM_ERROR, diagnostics: [] };
}

/** D5's delivery routing: a brand-new install (no `editing`), an in-place update when `editing`
 *  is at the tip of its own history, or — when it has been restored behind its own tip — a
 *  silent shared continuation (fork with `shareData:true`, no question asked per decision #52 D2
 *  / the `linked-apps` spec) followed by an update onto that fork. The ONLY three `StoreAccess`
 *  call shapes a `result` event may produce (spec "Delivery only through StoreAccess"). */
async function deliverResult(
  access: StoreAccess,
  editing: InstalledApp | undefined,
  text: string,
  wire: WireAppRecord,
): Promise<InstalledApp> {
  const prompt = envelope(text);
  const schemaJson = Object.keys(wire.schema).length > 0 ? JSON.stringify(wire.schema) : undefined;

  if (!editing) {
    const id = freshAppId();
    const record = mapWireRecord(id, wire);
    return access.install({ id, name: record.name, record, bundleSource: wire.bundle, source: wire.source, prompt, example: false, schemaJson });
  }

  const record = mapWireRecord(editing.record.appId, wire);
  if (await isAtTip(access, editing)) {
    return access.update(editing, { record, bundleSource: wire.bundle, source: wire.source, schemaJson, prompt });
  }
  const fork = await access.fork(editing, undefined, { shareData: true });
  return access.update(fork, { record, bundleSource: wire.bundle, source: wire.source, schemaJson, prompt });
}

export default function LauncherRoot() {
  // Construct the persistent host services once (device native modules — lazy under the hood).
  // The theme pref, device id, and server address all read from the SAME `whim.launcher`
  // KVBackend instance the installed-apps index uses (design D7 / prompt-flow-ux D2/D3 — one
  // MMKV instance, several consumers).
  const { index, access, kv } = useMemo(() => {
    const launcherKv: KVBackend = createMmkvBackend('whim.launcher');
    const idx = new AppIndex(launcherKv);
    const store = createPersistentStore(createMmkvBackend('whim-version-store'));
    const acc = new StoreAccess({ store, index: idx, deleteStorage: (appId) => deleteStorage({ appId }) });
    return { index: idx, access: acc, kv: launcherKv };
  }, []);

  return (
    <ThemeProvider>
      <LauncherShell index={index} access={access} kv={kv} />
    </ThemeProvider>
  );
}

function LauncherShell({ index, access, kv }: Readonly<{ index: AppIndex; access: StoreAccess; kv: KVBackend }>) {
  const { theme } = useTheme();
  const palette = shellPalette(theme);

  const [screen, setScreen] = useState<Screen>({ kind: 'home' });
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [ready, setReady] = useState(false);
  const [serverUrl, setServerUrl] = useState<string | undefined>(() => loadServerUrl(kv));
  const [highlighting, setHighlighting] = useState<boolean>(() => loadHighlighting(kv));

  const deviceId = useMemo(() => getDeviceId(kv), [kv]);
  const clientOptions = useMemo<ClientOptions | null>(
    () => (serverUrl != null ? { baseUrl: serverUrl, deviceId } : null),
    [serverUrl, deviceId],
  );

  // Tracks the in-flight generation's abort controller + the caller's own cancellation intent
  // (generation-client's abort contract: the caller must track intent itself rather than infer
  // it from the stream's output, since an abort and an unrelated truncated stream look
  // identical). Cleared once the generation settles (success, failure, or a deliberate cancel).
  const genRef = useRef<{ controller: AbortController; cancelled: boolean } | null>(null);

  const refresh = () => setApps(index.list());

  useEffect(() => {
    (async () => {
      try {
        await seedFirstRun(index, access, defaultSeeds());
      } catch (e) {
        console.log('[whim] seed failed:', (e as Error)?.message);
      }
      refresh();
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onOpen = async (app: InstalledApp) => {
    try {
      const source = await access.activeBundle(app);
      setScreen({ kind: 'app', app, record: app.record, source, engineAppId: access.engineAppId(app) });
    } catch (e) {
      Alert.alert('Could not open this app', (e as Error)?.message ?? String(e));
    }
  };

  const onFork = async (app: InstalledApp, opts: { shareData: boolean }) => {
    try {
      await access.fork(app, undefined, opts);
      refresh();
    } catch (e) {
      Alert.alert('Could not fork this app', (e as Error)?.message ?? String(e));
    }
  };

  const onHistory = (app: InstalledApp) => {
    setScreen({ kind: 'history', app });
  };

  const onDelete = async (app: InstalledApp) => {
    try {
      await access.remove(app);
      refresh();
    } catch (e) {
      Alert.alert('Could not delete this app', (e as Error)?.message ?? String(e));
    }
  };

  const goHome = () => {
    refresh();
    setScreen({ kind: 'home' });
  };

  const onServerUrlChange = (url: string) => {
    saveServerUrl(kv, url);
    setServerUrl(loadServerUrl(kv));
  };

  const onHighlightingChange = (enabled: boolean) => {
    saveHighlighting(kv, enabled);
    setHighlighting(enabled);
  };

  // ── Prompt flow orchestration (design D1) ──────────────────────────────────────────────────
  // Submit → rewrite → preview → approve → generate (SSE) → deliver. Presentational screens
  // (PromptScreen/RewritePreviewScreen/GeneratingScreen/FailureScreen) never touch fetch,
  // StoreAccess, or AbortController — all of that lives here, per the prompt-flow-screens handoff.

  const onPromptSubmit = async (editing: InstalledApp | undefined, text: string) => {
    if (!clientOptions) return; // PromptScreen only calls onSubmit when serverConfigured is true
    try {
      const rewritten = await rewritePrompt(clientOptions, text);
      setScreen({ kind: 'rewrite-preview', editing, originalPrompt: text, rewrittenPrompt: rewritten.rewrittenPrompt });
    } catch (e) {
      const { reason, diagnostics } = errorReason(e);
      setScreen({ kind: 'failure', editing, prompt: text, reason, diagnostics });
    }
  };

  const onApprovePreview = async (editing: InstalledApp | undefined, text: string) => {
    if (!clientOptions) return;
    setScreen({ kind: 'generating', editing, prompt: text, stage: null });

    const controller = new AbortController();
    const ctl = { controller, cancelled: false };
    genRef.current = ctl;

    try {
      const request = await buildGenerateRequest(access, (appId) => peekAppliedSchema({ appId }), editing, text);
      let terminal: GenerationEvent | null = null;

      // Only `stage` ever reaches UI state (never `token.text` or `diagnostic.kind`/`symbol` —
      // spec "Generation progress is shown without exposing internals"); `result`/`failure` are
      // held until the stream ends so the terminal-event handling below stays in one place.
      for await (const event of generateApp(clientOptions, request, controller.signal)) {
        if (event.type === 'stage') {
          setScreen((s) => (s.kind === 'generating' ? { ...s, stage: event.stage } : s));
        } else if (event.type === 'result' || event.type === 'failure') {
          terminal = event;
        }
      }

      if (ctl.cancelled) return; // cancel-on-navigate-away: nothing installed/updated
      genRef.current = null;

      if (terminal == null) {
        // Stream ended with no terminal event and no cancel — a stream error, not a crash.
        setScreen({ kind: 'failure', editing, prompt: text, reason: GENERIC_STREAM_ERROR, diagnostics: [] });
        return;
      }
      if (terminal.type === 'failure') {
        setScreen({
          kind: 'failure',
          editing,
          prompt: text,
          reason: terminal.reason,
          diagnostics: terminal.diagnostics.map((d) => ({ hint: d.hint })),
        });
        return;
      }

      const delivered = await deliverResult(access, editing, text, terminal.app);
      refresh();
      const source = await access.activeBundle(delivered);
      setScreen({ kind: 'app', app: delivered, record: delivered.record, source, engineAppId: access.engineAppId(delivered) });
    } catch (e) {
      if (ctl.cancelled) return;
      genRef.current = null;
      const { reason, diagnostics } = errorReason(e);
      setScreen({ kind: 'failure', editing, prompt: text, reason, diagnostics });
    }
  };

  /** Hardware back AND the visible Cancel button both land here (design "cancel-on-navigate-away").
   *  Aborts the in-flight request and returns to the prompt screen with the text preserved —
   *  nothing is installed or updated, since the generation loop above bails out on `ctl.cancelled`
   *  before ever reaching `deliverResult`. */
  const onCancelGeneration = (editing: InstalledApp | undefined, prompt: string) => {
    const ctl = genRef.current;
    if (ctl) {
      ctl.cancelled = true;
      ctl.controller.abort();
      genRef.current = null;
    }
    setScreen({ kind: 'prompt', editing, initialText: prompt });
  };

  // v2: the shell is fixed and always light (paper), never dark — see theme.ts.
  const statusBarStyle = 'dark-content';

  if (!ready) {
    return (
      <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: palette.bg }]}>
        <StatusBar barStyle={statusBarStyle} />
        <View style={styles.loading}>
          <ActivityIndicator color={palette.accent} />
        </View>
      </SafeAreaView>
    );
  }

  let content: React.ReactNode;
  if (screen.kind === 'app') {
    content = (
      <MiniAppView
        key={screen.app.id}
        record={screen.record}
        bundleSource={screen.source}
        engineAppId={screen.engineAppId}
        theme={theme}
        onExit={goHome}
      />
    );
  } else if (screen.kind === 'dev') {
    content = <DevProbeScreen onExit={goHome} />;
  } else if (screen.kind === 'settings') {
    content = (
      <SettingsScreen
        onBack={goHome}
        serverUrl={serverUrl}
        onServerUrlChange={onServerUrlChange}
        highlighting={highlighting}
        onHighlightingChange={onHighlightingChange}
      />
    );
  } else if (screen.kind === 'history') {
    content = <HistoryScreen app={screen.app} access={access} onBack={goHome} />;
  } else if (screen.kind === 'prompt') {
    const { editing, initialText } = screen;
    content = (
      <PromptScreen
        editing={editing}
        initialText={initialText}
        serverConfigured={clientOptions != null}
        onSubmit={(text) => onPromptSubmit(editing, text)}
        onBack={goHome}
        onOpenSettings={() => setScreen({ kind: 'settings' })}
      />
    );
  } else if (screen.kind === 'rewrite-preview') {
    const { editing, originalPrompt } = screen;
    content = (
      <RewritePreviewScreen
        originalPrompt={originalPrompt}
        rewrittenPrompt={screen.rewrittenPrompt}
        onApprove={(text) => onApprovePreview(editing, text)}
        onBack={() => setScreen({ kind: 'prompt', editing, initialText: originalPrompt })}
      />
    );
  } else if (screen.kind === 'generating') {
    const { editing, prompt } = screen;
    content = <GeneratingScreen stage={screen.stage} onCancel={() => onCancelGeneration(editing, prompt)} />;
  } else if (screen.kind === 'failure') {
    const { editing, prompt } = screen;
    content = (
      <FailureScreen
        reason={screen.reason}
        diagnostics={screen.diagnostics}
        onRephrase={() => setScreen({ kind: 'prompt', editing, initialText: prompt })}
        onDismiss={goHome}
      />
    );
  } else {
    content = (
      <HomeScreen
        apps={apps}
        onOpen={onOpen}
        onFork={onFork}
        onDelete={onDelete}
        onHistory={onHistory}
        onPromptAgain={(app) => setScreen({ kind: 'prompt', editing: app })}
        onCreate={() => setScreen({ kind: 'prompt' })}
        onSettings={() => setScreen({ kind: 'settings' })}
        onOpenDevProbe={__DEV__ ? () => setScreen({ kind: 'dev' }) : undefined}
      />
    );
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: palette.bg }]}>
      <StatusBar barStyle={statusBarStyle} />
      {content}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
