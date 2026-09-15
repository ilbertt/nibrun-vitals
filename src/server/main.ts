import { statSync } from 'node:fs';
import { getPublicAssets } from '#assets.ts';
import * as collector from '#collector.ts';
import { achievements, level } from '#game.ts';
import * as store from '#store.ts';
import type { BoopPayload, HitsPayload, Sample, StatsPayload } from '#types.ts';

const DEFAULT_PORT = 3000;
const PORT = Number(process.env.PORT ?? process.env.NIBRUN_HTTP_PORT ?? DEFAULT_PORT);
const MS_PER_S = 1000;
const MIB = 1_048_576;
const S_PER_HOUR = 3600;
/** "online now" = distinct visitors seen in the last 3 minutes, memory only */
const LIVE_WINDOW_S = 180;
/** A tick this late means the VM was paused in between. */
const NAP_THRESHOLD_MS = 60_000;
/** The first request after a wake arrives before the overdue timer; refresh past this age. */
const STALE_AFTER_MS = 2 * collector.INTERVAL_S * MS_PER_S;
const FIRST_TICK_DELAY_MS = 1000;
const HASH_LENGTH = 16;
const RESPONSE_SAMPLES = 1000;
const P50 = 0.5;
const P95 = 0.95;
const MICRO = 1000;
const BOOP_COOLDOWN_MS = 250;
const BOOP_MAP_LIMIT = 5000;
const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_TOO_MANY = 429;
const BOT_UA =
  /bot|crawl|spider|slurp|curl|wget|python|go-http|java|headless|lighthouse|preview|monitor|uptime|scan/i;

const bootedAt = Date.now();
const machine = collector.machine();

function binarySize(): string {
  try {
    return `${Math.round(statSync(process.execPath).size / MIB)} MB`;
  } catch {
    return 'one file';
  }
}

// The page and everything it links, as the page bundler left them: `index.html` gets the
// numbers that should be right at first paint substituted once, every other file is served as
// it is, immutable because its name carries a hash.
const assets = getPublicAssets();
const page = await assets.get('index.html')?.text();
if (!page) {
  console.error('❌ No built page found: run `bun run build` (or `dev`, which builds it).');
  process.exit(1);
}
const html = page
  .replaceAll('%HOST%', machine.hostname)
  .replaceAll('%HOST_SLUG%', machine.hostname.replace(/\.nibrun\.app$/, ''))
  .replaceAll('%RAM%', `${machine.ram_mb} MB`)
  .replaceAll('%CORES%', `${machine.cores} vCPU${machine.cores === 1 ? '' : 's'}`)
  .replaceAll('%CORES_N%', String(machine.cores))
  .replaceAll('%DISK%', machine.disk_gb ? `${machine.disk_gb} GB` : '?')
  .replaceAll('%RUNTIME%', machine.runtime.toLowerCase())
  .replaceAll('%ARCH%', `linux/${machine.arch}`)
  .replaceAll('%BIN%', binarySize());

// ---- visitors ----
type Ctx = { req: Request; server: Bun.Server<undefined> };
const live = new Map<string, number>(); // visitor hash -> last seen (ms)
let peak = Number(store.getMeta('peak') ?? 0);
let peakAt = Number(store.getMeta('peak_at') ?? 0);

// nibrun fronts the app with Cloudflare and then Caddy: x-forwarded-for holds Cloudflare's edge,
// cf-connecting-ip the visitor. Anything else is a fallback for running elsewhere.
function clientIp({ req, server }: Ctx): string {
  const h = req.headers;
  return (
    h.get('cf-connecting-ip') ??
    h.get('x-real-ip') ??
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    server.requestIP(req)?.address ??
    '?'
  );
}

function visitorHash(ctx: Ctx): string {
  const ua = ctx.req.headers.get('user-agent') ?? '';
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(`${store.salt}|${store.dayKey(Date.now())}|${clientIp(ctx)}|${ua}`);
  return hasher.digest('hex').slice(0, HASH_LENGTH);
}

function countHit(ctx: Ctx) {
  const ua = ctx.req.headers.get('user-agent') ?? '';
  if (!ua || BOT_UA.test(ua)) {
    return;
  }
  const now = Date.now();
  const h = visitorHash(ctx);
  live.set(h, now);
  store.recordHit({ day: store.dayKey(now), h, country: ctx.req.headers.get('cf-ipcountry') });
}

function liveCount(now: number): number {
  for (const [h, t] of live) {
    if (now - t > LIVE_WINDOW_S * MS_PER_S) {
      live.delete(h);
    }
  }
  return live.size;
}

// ---- page load timing: how long the process takes to answer "/" ----
const responseTimes: number[] = [];
function recordResponseTime(ms: number) {
  responseTimes.push(ms);
  if (responseTimes.length > RESPONSE_SAMPLES) {
    responseTimes.shift();
  }
}
function responseStats() {
  if (!responseTimes.length) {
    return { median_ms: null, p95_ms: null, n: 0 };
  }
  // A typed array sorts numerically on its own; a plain array would need a comparator.
  const sorted = Float64Array.from(responseTimes).sort();
  const quantile = (p: number) =>
    Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! * MICRO) / MICRO;
  return { median_ms: quantile(P50), p95_ms: quantile(P95), n: sorted.length };
}

// ---- the collector tick ----
const history: Sample[] = store.loadSamples(Math.floor(bootedAt / MS_PER_S) - S_PER_HOUR);
let stats = '{}';
let lastTick = bootedAt;

function updatePeak(now: number) {
  const n = liveCount(now);
  if (n > peak) {
    peak = n;
    peakAt = now;
    store.setMeta({ key: 'peak', value: peak });
    store.setMeta({ key: 'peak_at', value: peakAt });
  }
}

function tick() {
  const now = Date.now();
  if (now - lastTick > NAP_THRESHOLD_MS) {
    store.addNap({ startS: Math.floor(lastTick / MS_PER_S), endS: Math.floor(now / MS_PER_S) });
  }
  updatePeak(now);
  const { s, mem, disk, net, load, procs } = collector.sample();
  history.push(s);
  while (history.length && history[0]!.t < s.t - S_PER_HOUR) {
    history.shift();
  }
  store.addSample(s);
  // Credit the seconds actually elapsed since the last tick (the first one is a partial interval).
  const elapsedS = Math.round((now - lastTick) / MS_PER_S);
  store.tickUptime({ day: store.dayKey(now), seconds: Math.min(collector.INTERVAL_S, elapsedS) });
  lastTick = now;
  if (now % (S_PER_HOUR * MS_PER_S) < collector.INTERVAL_S * MS_PER_S) {
    store.prune(now);
  }

  const boots = store.boots();
  const dayStartS = Date.parse(`${store.dayKey(now)}T00:00:00Z`) / MS_PER_S;
  const payload: StatsPayload = {
    ts: s.t,
    interval_s: collector.INTERVAL_S,
    uptime_s: collector.uptimeS(),
    process_uptime_s: Math.round((now - bootedAt) / MS_PER_S),
    boots: { count: boots.count, last: boots.last, first: store.firstBoot },
    naps: store.naps(dayStartS),
    cpu: { pct: s.cpu, cores: machine.cores, load },
    mem,
    disk,
    net,
    procs,
    process: { rss_mb: s.rss, runtime: machine.runtime },
    response: responseStats(),
    machine,
    history: {
      t: history.map((x) => x.t),
      cpu: history.map((x) => x.cpu),
      mem: history.map((x) => x.mem),
      rx: history.map((x) => x.rx),
      tx: history.map((x) => x.tx),
      rss: history.map((x) => x.rss),
    },
  };
  stats = JSON.stringify(payload);
}

function hits() {
  const now = Date.now();
  const nowS = Math.floor(now / MS_PER_S);
  const summary = store.summary(now);
  const payload: HitsPayload = {
    ts: nowS,
    now: liveCount(now),
    peak,
    peak_at: peakAt ? Math.floor(peakAt / MS_PER_S) : null,
    window_s: LIVE_WINDOW_S,
    countries: store.countries(store.dayKey(now)),
    boops: store.boops,
    level: level(summary.total_views),
    achievements: achievements({
      nowS,
      bootedAtS: Math.floor(bootedAt / MS_PER_S),
      totalViews: summary.total_views,
      bootCount: store.boots().count,
      peak,
    }),
    ...summary,
  };
  return JSON.stringify(payload);
}

// ---- responses ----
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};
const json = ({ body, status }: { body: string; status?: number }) =>
  new Response(body, { status, headers: JSON_HEADERS });
const notFound = () => new Response('not found', { status: HTTP_NOT_FOUND });

// One boop per 250 ms per visitor; more than that is a held-down key, not affection.
const lastBoop = new Map<string, number>();
function boop(ctx: Ctx): Response {
  const now = Date.now();
  const h = visitorHash(ctx);
  if (now - (lastBoop.get(h) ?? 0) < BOOP_COOLDOWN_MS) {
    const body: BoopPayload = { boops: store.boops };
    return json({ body: JSON.stringify(body), status: HTTP_TOO_MANY });
  }
  lastBoop.set(h, now);
  if (lastBoop.size > BOOP_MAP_LIMIT) {
    for (const [k, t] of lastBoop) {
      if (now - t > NAP_THRESHOLD_MS) {
        lastBoop.delete(k);
      }
    }
  }
  const body: BoopPayload = { boops: store.bump() };
  return json({ body: JSON.stringify(body) });
}

function servePage(ctx: Ctx): Response {
  const t0 = performance.now();
  if (ctx.req.method === 'GET') {
    countHit(ctx);
  }
  const res = new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
  });
  recordResponseTime(performance.now() - t0);
  return res;
}

function serveStats(): Response {
  if (Date.now() - lastTick > STALE_AFTER_MS) {
    tick();
  }
  return json({ body: stats });
}

// Every file the page bundler produced, one native static route each: Bun answers
// `If-None-Match` with a 304 by itself, and the hashed names are safe to cache for a year.
const staticRoutes: Record<string, Response> = {};
for (const [path, blob] of assets) {
  if (path !== 'index.html') {
    staticRoutes[`/${path}`] = new Response(blob, {
      headers: {
        'content-type': blob.type,
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  }
}

// Annotated because the route handlers close over it: inferring the type would go through them.
const server: Bun.Server<undefined> = Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  routes: {
    ...staticRoutes,
    '/': {
      GET: (req) => servePage({ req, server }),
      HEAD: (req) => servePage({ req, server }),
    },
    '/api/stats': { GET: serveStats },
    '/api/hits': { GET: () => json({ body: hits() }) },
    '/api/boop': { POST: (req) => boop({ req, server }) },
    '/healthz': { GET: () => new Response('ok') },
  },
  fetch(req) {
    return req.method === 'GET' || req.method === 'HEAD' || req.method === 'POST'
      ? notFound()
      : new Response('method not allowed', { status: HTTP_METHOD_NOT_ALLOWED });
  },
});

// Prime the CPU/network deltas, then take the first real sample right away.
collector.sample();
setTimeout(() => {
  tick();
  setInterval(tick, collector.INTERVAL_S * MS_PER_S);
}, FIRST_TICK_DELAY_MS);

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.stop(true);
    store.db.close();
    process.exit(0);
  });
}

console.log(
  `vitals listening on http://0.0.0.0:${PORT} — data in ${collector.DATA_DIR}, ${machine.cpu} × ${machine.cores}, ${machine.ram_mb} MB`,
);
