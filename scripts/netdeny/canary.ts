/**
 * scripts/netdeny/canary.ts — the network-deny reproduction canary (design D17 "Reproduce first,
 * then prove"). Run through `scripts/netdeny/run.mjs`:
 *
 *   node scripts/netdeny/run.mjs canary --expect leak|zero [--bind 127.0.0.1]
 *     [--http-port 8765] [--tls-port 8766] [--seconds 180]
 *
 * Serves `GET /wnd/bundle/<variant>?http=<httpBase>&tls=<tlsBase>&run=<runId>`, compiling
 * `canaryAppSource(variant, {httpBase, tlsBase, runId})` with `synthrun/builder.ts`'s
 * `buildCandidateSource` (the production bundle contract) and returning the built JS as the
 * response body. Each successful build is counted as a bundle fetch for that variant, never as a
 * hit. Every other HTTP request is counted as a hit keyed by the variant name in its path
 * (`/wnd/hit/<variant>` → `<variant>`, anything else keyed by its raw path). A second, plain TCP
 * listener (the "TLS port") counts accepted connections and closes each socket immediately —
 * proving the egress happened without needing to terminate TLS.
 *
 * At exit (the `--seconds` timer, or SIGINT) it prints one `bundle <variant> <count>` line per
 * navigation variant, one `hit <path> <count>` line per path that was hit, then one summary line:
 *
 *   NETDENY PASS|FAIL expect=<leak|zero> bundles=<total bundle fetch count> hits=<total hit count>
 *     tls=<tls connection count> [missing=<a,b,c>]
 *
 * `--expect zero` passes only when every navigation variant's bundle was fetched at least once —
 * a canary that never saw a real bundle request proves nothing (a wrong build, a disabled flag, or
 * a blocked fetch would otherwise print PASS with no traffic to deny at all) — AND no path was hit
 * AND no TLS connection was accepted; a failing `zero` expectation appends `missing=<…>` naming
 * every un-fetched variant. `--expect leak` keeps its own rule, unaffected by bundle counts: it
 * passes only when `loc-href`, `loc-assign`, `meta-refresh`, `anchor-click` and `host-top-frame`
 * each have at least one hit AND the TLS port saw a connection; a failing `leak` expectation
 * appends `missing=<…>` naming every one of those five that didn't.
 * Exit 0 on pass, 1 on fail, 2 on a usage error.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import type { Server as NetServer, Socket } from 'node:net';
import { buildCandidateSource } from '../../synthrun/builder';
import { canaryAppSource, NAVIGATION_VARIANTS } from './variants';
import type { NavigationVariant } from './variants';

/** The variants `--expect leak` requires a hit for, plus the TLS port. `host-top-frame` has no
 *  mini-app source (it's injected by the probe screen into the outer page), but the canary counts
 *  its hit the same way as every other path. */
const LEAK_REQUIRED: readonly string[] = ['loc-href', 'loc-assign', 'meta-refresh', 'anchor-click', 'host-top-frame'];

interface Options {
  bind: string;
  httpPort: number;
  tlsPort: number;
  seconds: number;
  expect: 'leak' | 'zero';
}

function usageError(message: string): never {
  process.stderr.write(`netdeny canary: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv: readonly string[]): Options {
  if (argv[0] !== 'canary') usageError(`expected the "canary" command, got ${JSON.stringify(argv[0] ?? '')}`);
  let bind = '127.0.0.1';
  let httpPort = 8765;
  let tlsPort = 8766;
  let seconds = 180;
  let expect: 'leak' | 'zero' | undefined;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    const value = (): string => {
      i += 1;
      const v = argv[i];
      if (v === undefined) usageError(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case '--bind':
        bind = value();
        break;
      case '--http-port':
        httpPort = Number(value());
        break;
      case '--tls-port':
        tlsPort = Number(value());
        break;
      case '--seconds':
        seconds = Number(value());
        break;
      case '--expect': {
        const v = value();
        if (v !== 'leak' && v !== 'zero') usageError(`--expect must be "leak" or "zero", got ${JSON.stringify(v)}`);
        expect = v;
        break;
      }
      default:
        usageError(`unknown argument ${JSON.stringify(arg)}`);
    }
  }
  if (!expect) usageError('--expect leak|zero is required');
  if (!Number.isFinite(httpPort) || !Number.isFinite(tlsPort) || !Number.isFinite(seconds)) {
    usageError('--http-port, --tls-port and --seconds must be numbers');
  }
  return { bind, httpPort, tlsPort, seconds, expect };
}

/** Query-string parsing without a `URL` global (the app's ambient surface carries no DOM/Node
 *  `URL` type — see `scripts/netdeny/env.d.ts`'s header). */
function parseRequestUrl(reqUrl: string): { path: string; query: Record<string, string> } {
  const qIndex = reqUrl.indexOf('?');
  const path = qIndex === -1 ? reqUrl : reqUrl.slice(0, qIndex);
  const query: Record<string, string> = {};
  if (qIndex !== -1) {
    for (const pair of reqUrl.slice(qIndex + 1).split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const k = eq === -1 ? pair : pair.slice(0, eq);
      const v = eq === -1 ? '' : pair.slice(eq + 1);
      query[decodeURIComponent(k)] = decodeURIComponent(v);
    }
  }
  return { path, query };
}

function isNavigationVariant(v: string): v is NavigationVariant {
  return (NAVIGATION_VARIANTS as readonly string[]).includes(v);
}

function computeVerdict(
  opts: Options,
  bundleFetches: ReadonlyMap<NavigationVariant, number>,
  hits: ReadonlyMap<string, number>,
  tlsHits: number,
): { pass: boolean; lines: string[] } {
  const lines: string[] = [];
  for (const variant of NAVIGATION_VARIANTS) {
    lines.push(`bundle ${variant} ${bundleFetches.get(variant) ?? 0}`);
  }
  for (const [path, count] of [...hits.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`hit ${path} ${count}`);
  }
  let pass: boolean;
  let missing: string[] = [];
  if (opts.expect === 'zero') {
    missing = NAVIGATION_VARIANTS.filter((v) => !(bundleFetches.get(v) ?? 0));
    pass = missing.length === 0 && hits.size === 0 && tlsHits === 0;
  } else {
    missing = LEAK_REQUIRED.filter((v) => !(hits.get(v) ?? 0));
    pass = missing.length === 0 && tlsHits > 0;
  }
  const totalHits = [...hits.values()].reduce((a, b) => a + b, 0);
  const totalBundles = [...bundleFetches.values()].reduce((a, b) => a + b, 0);
  let summary =
    `NETDENY ${pass ? 'PASS' : 'FAIL'} expect=${opts.expect} bundles=${totalBundles} ` +
    `hits=${totalHits} tls=${tlsHits}`;
  if (!pass && missing.length > 0) summary += ` missing=${missing.join(',')}`;
  lines.push(summary);
  return { pass, lines };
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  const bundleFetches = new Map<NavigationVariant, number>();
  const hits = new Map<string, number>();
  let tlsHits = 0;

  const httpServer = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    const { path, query } = parseRequestUrl(req.url ?? '/');
    const bundleMatch = /^\/wnd\/bundle\/([a-z0-9-]+)$/.exec(path);
    if (bundleMatch) {
      const variant = bundleMatch[1];
      if (!isNavigationVariant(variant)) {
        process.stderr.write(`netdeny canary: refused bundle request for unknown variant ${JSON.stringify(variant)}\n`);
        res.end('');
        return;
      }
      const httpBase = query.http ?? '';
      const tlsBase = query.tls ?? '';
      const runId = query.run ?? '';
      buildCandidateSource(canaryAppSource(variant, { httpBase, tlsBase, runId }))
        .then((built) => {
          bundleFetches.set(variant, (bundleFetches.get(variant) ?? 0) + 1);
          res.end(built.js);
        })
        .catch((err) => {
          process.stderr.write(`netdeny canary: bundle build failed for ${variant}: ${(err as Error).message}\n`);
          res.end('');
        });
      return;
    }
    const hitMatch = /^\/wnd\/hit\/([a-z0-9-]+)$/.exec(path);
    const key = hitMatch ? hitMatch[1] : path;
    hits.set(key, (hits.get(key) ?? 0) + 1);
    res.end('');
  });

  const tlsServer: NetServer = createNetServer((socket: Socket) => {
    tlsHits += 1;
    socket.destroy();
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(opts.httpPort, opts.bind, resolve);
  });
  await new Promise<void>((resolve, reject) => {
    tlsServer.once('error', reject);
    tlsServer.listen(opts.tlsPort, opts.bind, resolve);
  });

  process.stderr.write(
    `netdeny canary: listening http=http://${opts.bind}:${opts.httpPort} tls=https://${opts.bind}:${opts.tlsPort} ` +
      `expect=${opts.expect} seconds=${opts.seconds}\n`,
  );

  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, opts.seconds * 1000);
    process.once('SIGINT', () => {
      clearTimeout(timer);
      resolve();
    });
  });

  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await new Promise<void>((resolve) => tlsServer.close(() => resolve()));

  const { pass, lines } = computeVerdict(opts, bundleFetches, hits, tlsHits);
  for (const line of lines) process.stdout.write(`${line}\n`);
  return pass ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`netdeny canary: crashed: ${(err as Error).message}\n`);
    process.exit(1);
  });
