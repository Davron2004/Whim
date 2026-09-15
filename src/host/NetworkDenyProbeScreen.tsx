/**
 * On-device reproduction probe for the network-deny leg (design D17 "Reproduce first, then
 * prove"; tasks 15.3–15.4). Runs every self-navigation variant against a canary the operator
 * starts on the Mac (`node scripts/netdeny/run.mjs canary`, handoff/netdeny-probe.md), one at a
 * time: fetches the variant's canary bundle over RN `fetch`, mounts a fresh `<WebView>` keyed by
 * the variant with `MiniAppView`'s exact props, delivers on the first `onLoadEnd` with
 * `deliverBySourceJs`, and dwells 5s before moving on. `host-top-frame` skips the bundle fetch and
 * instead injects a top-frame navigation into the OUTER runtime page — the spec's second scenario
 * ("A load started by the host page is refused too").
 *
 * Not in the default app path — App.tsx renders this only when `RUN_NETDENY_PROBE` is on
 * (default false, checked before the other on-device probes). `NETDENY_PROBE_MARKER` below is the
 * probe-only literal an operator greps a bundle for (handoff/netdeny-probe.md).
 *
 * Logs through `src/host/logging` rather than `console.*`: `src/host/logging/test/logging.suite.ts`
 * fails any `console.*` call and any retired bracketed log-prefix literal outside its own
 * hand-listed probe surfaces, and this file is not on that list.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { RUNTIME_HTML } from '../runtime/generated/runtime-html';
import { deliverBySourceJs } from './launcher/deliver';
import { log } from './logging';
import { CHANNELS } from './logging/channels';

/** The probe-only literal an operator greps a bundle for (handoff/netdeny-probe.md). Present
 *  whenever this module is part of the bundle graph, independent of the `RUN_NETDENY_PROBE`
 *  value — it identifies the SCREEN, not whether it is currently active. */
export const NETDENY_PROBE_MARKER = 'whim-netdeny-probe-marker-v1';

/** Mirrors `scripts/netdeny/variants.ts`'s `NetdenyVariant` union verbatim (kept in sync by hand:
 *  one runs under Node, the other under Hermes, and neither should import the other). */
type NetdenyVariant =
  | 'loc-href'
  | 'loc-assign'
  | 'meta-refresh'
  | 'anchor-click'
  | 'loc-href-https'
  | 'dns-name'
  | 'host-top-frame';

/** Every variant the probe runs, in order. Mirrors `scripts/netdeny/variants.ts`'s
 *  `NAVIGATION_VARIANTS` plus `host-top-frame` last. */
const ALL_VARIANTS: readonly NetdenyVariant[] = [
  'loc-href',
  'loc-assign',
  'meta-refresh',
  'anchor-click',
  'loc-href-https',
  'dns-name',
  'host-top-frame',
];

const DWELL_MS = 5000;
const HTTP_PORT = 8765;
const TLS_PORT = 8766;

/** Overrides the canary host derived from `Platform.OS` (`10.0.2.2` on Android, `127.0.0.1` on
 *  iOS) — a physical device needs the Mac's LAN address here. `null` by default. */
export const NETDENY_CANARY_HOST_OVERRIDE: string | null = null;

interface Row {
  variant: NetdenyVariant;
  bundle: string;
  messages: string[];
  errors: string[];
}

interface RunState {
  variant: NetdenyVariant;
  row: Row;
  delivered: boolean;
  bundleSource: string | null;
  /** Set once, right before the WebView mounts; `handleLoadEnd` calls it after the dwell. */
  resolveDwell: () => void;
}

function emptyRow(variant: NetdenyVariant): Row {
  return { variant, bundle: variant === 'host-top-frame' ? 'n/a' : 'pending', messages: [], errors: [] };
}

export default function NetworkDenyProbeScreen() {
  const [runId] = useState(() => String(Date.now()));
  const [rows, setRows] = useState<Row[]>(() => ALL_VARIANTS.map(emptyRow));
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [doneAll, setDoneAll] = useState(false);
  const webRef = useRef<WebView | null>(null);
  const runRef = useRef<RunState | null>(null);

  // The Android emulator's fixed host-loopback alias (CLAUDE.md "Android build & run"), not a
  // real network address.
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- see comment above
  const host = NETDENY_CANARY_HOST_OVERRIDE ?? (Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1');
  const httpBase = `http://${host}:${HTTP_PORT}`;
  const tlsBase = `https://${host}:${TLS_PORT}`;

  useEffect(() => {
    let cancelled = false;

    function setRowAt(index: number, row: Row): void {
      setRows((prev) => {
        const next = prev.slice();
        next[index] = row;
        return next;
      });
    }

    async function runOne(index: number): Promise<void> {
      const variant = ALL_VARIANTS[index];
      const row = emptyRow(variant);
      setRowAt(index, row);

      let bundleSource: string | null = null;
      if (variant !== 'host-top-frame') {
        const url = `${httpBase}/wnd/bundle/${variant}?http=${encodeURIComponent(httpBase)}&tls=${encodeURIComponent(tlsBase)}&run=${runId}`;
        try {
          const res = await fetch(url);
          bundleSource = await res.text();
          row.bundle = res.ok ? 'fetched' : `http ${res.status}`;
        } catch (e) {
          row.bundle = `error: ${e instanceof Error ? e.message : String(e)}`;
        }
        setRowAt(index, { ...row });
      }
      if (cancelled) return;

      await new Promise<void>((resolve) => {
        runRef.current = { variant, row, delivered: false, bundleSource, resolveDwell: resolve };
        setActiveIndex(index);
      });

      setRowAt(index, { ...row });
      log.info(CHANNELS.app, 'netdeny variant finished', {
        variant,
        bundle: row.bundle,
        messages: row.messages,
        errors: row.errors,
      });
    }

    (async () => {
      for (let i = 0; i < ALL_VARIANTS.length; i++) {
        if (cancelled) return;
        await runOne(i);
      }
      if (!cancelled) {
        setDoneAll(true);
        log.info(CHANNELS.app, 'netdeny probe done', { runId, variants: ALL_VARIANTS.length });
      }
    })();

    return () => {
      cancelled = true;
    };
    // Intentionally runs once per mount: `httpBase`/`tlsBase`/`runId` are stable for the screen's
    // lifetime (derived once from `Platform.OS`/mount time).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLoadEnd = (): void => {
    const run = runRef.current;
    if (!run || run.delivered) return;
    run.delivered = true;
    const ref = webRef.current;
    if (ref) {
      if (run.variant === 'host-top-frame') {
        const target = `${httpBase}/wnd/hit/host-top-frame?run=${runId}`;
        ref.injectJavaScript(`try{location.href=${JSON.stringify(target)};}catch(e){};true;`);
      } else if (run.bundleSource) {
        try {
          const js = deliverBySourceJs({
            name: run.variant,
            source: run.bundleSource,
            generation: ALL_VARIANTS.indexOf(run.variant) + 1,
          });
          ref.injectJavaScript(js);
        } catch (e) {
          run.row.errors.push(`deliver: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    setTimeout(() => run.resolveDwell(), DWELL_MS);
  };

  const handleMessage = (e: { nativeEvent: { data: string } }): void => {
    const run = runRef.current;
    if (!run) return;
    let m: unknown;
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch (parseError) {
      log.debug(CHANNELS.app, 'netdeny probe: frame from the sandboxed page is not JSON', {
        detail: parseError instanceof Error ? parseError.message : String(parseError),
      });
      return;
    }
    if (!m || typeof m !== 'object') return;
    const rec = m as Record<string, unknown>;
    const kind = typeof rec.kind === 'string' ? rec.kind : 'unknown';
    let label = kind;
    if (kind === 'probes') {
      const payload = rec.payload as Record<string, unknown> | undefined;
      label += ` trusted=${rec.trusted === true} contained=${!!payload?.contained}`;
    }
    run.row.messages.push(label);
  };

  const handleError = (e: { nativeEvent: { url?: string; code?: number | string; description?: string; domain?: string } }): void => {
    const run = runRef.current;
    if (!run) return;
    const n = e.nativeEvent;
    const domain = Platform.OS === 'ios' ? ` domain=${n.domain ?? '?'}` : '';
    run.row.errors.push(`url=${n.url ?? '?'} code=${n.code ?? '?'} description=${n.description ?? '?'}${domain}`);
  };

  const activeVariant = activeIndex === null ? null : ALL_VARIANTS[activeIndex];

  return (
    <SafeAreaView style={styles.root}>
      <Text style={styles.title}>Whim · network-deny probe ({NETDENY_PROBE_MARKER})</Text>
      <Text style={styles.muted}>run={runId} http={httpBase} tls={tlsBase}</Text>
      <ScrollView style={styles.body}>
        {rows.map((row) => (
          <View key={row.variant} style={styles.row}>
            <Text style={styles.mono}>{row.variant}: bundle={row.bundle}</Text>
            <Text style={styles.mono}>  messages: {row.messages.join(', ') || '—'}</Text>
            <Text style={styles.mono}>  errors: {row.errors.join(', ') || '—'}</Text>
          </View>
        ))}
        <Text style={[styles.mono, styles.done]}>{doneAll ? 'done' : `running: ${activeVariant ?? '—'}`}</Text>
      </ScrollView>
      {activeVariant && (
        <WebView
          key={activeVariant}
          ref={webRef}
          style={styles.web}
          originWhitelist={['*']}
          source={{ html: RUNTIME_HTML }}
          onMessage={handleMessage}
          onLoadEnd={handleLoadEnd}
          javaScriptEnabled
          domStorageEnabled={false}
          setSupportMultipleWindows={false}
          onError={handleError}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b1020', paddingHorizontal: 12 },
  title: { color: '#cbd5e1', fontSize: 13, fontWeight: '600', marginBottom: 4 },
  muted: { color: '#64748b', fontSize: 11, marginBottom: 8 },
  body: { flex: 1 },
  row: { marginBottom: 8 },
  mono: { color: '#e2e8f0', fontFamily: 'monospace', fontSize: 10, lineHeight: 14 },
  done: { marginTop: 8, color: '#22c55e' },
  // Visible (not zero-sized): design D17 "Each canary app paints a heading and acts after
  // delay(300)" — the operator confirms the paint on screen before the navigation fires.
  web: { height: 160, width: '100%', backgroundColor: '#000' },
});
