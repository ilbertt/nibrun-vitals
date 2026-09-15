import { createFace } from '@bwnd/bbot';
import mono from '@fontsource/space-mono/files/space-mono-latin-400-normal.woff2' with {
  type: 'file',
};
import monoBold from '@fontsource/space-mono/files/space-mono-latin-700-normal.woff2' with {
  type: 'file',
};
import grotesk from '@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2' with {
  type: 'file',
};
import type { Achievement, BoopPayload, HitsPayload, StatsPayload } from '../server/types.ts';

const MS_PER_S = 1000;
const S_PER_MIN = 60;
const S_PER_HOUR = 3600;
const S_PER_DAY = 86_400;
const PERCENT = 100;
const TENTHS = 10;
const KIB = 1024;
const TINY_MS = 0.01;
const STATS_EVERY_MS = 10_000;
const HITS_EVERY_MS = 15_000;
const TICKER_EVERY_MS = 1000;
const STALE_AFTER_S = 45;
const DAY_KEY_LENGTH = 10;
const REGIONAL_INDICATOR_A = 0x1f1e6;
const CHAR_CODE_A = 65;
const CPU_FOCUS_PCT = 35;
const CPU_WORRIED_PCT = 75;
const BOOP_FACE_MS = 900;
const SEGMENTS = 16;
const SEG_CRIT_PCT = 15;
const SEG_WARN_PCT = 35;
const PIXEL_FULL_PCT = 99;
const BAR_MIN_PCT = 5;
const COUNTRIES_SHOWN = 8;
const TERM_GAP = 3;
const TERM_KEY_WIDTH = 9;
const TRACE_W = 600;
const TRACE_H = 84;
const TRACE_PAD = 4;
const TRACE_GAP_TICKS = 2.5;
const CPU_TRACE_FLOOR = 5;

const GREEN = 'oklch(0.78 0.19 149)';
const BLUE = 'oklch(0.75 0.13 230)';
const INK_UNLOCKED = '#0a0a0a';
const INK_LOCKED = '#4a5c4f';

// ---- nibrun's type, the latin subsets, emitted as files next to the page ----
// Declared here rather than in the stylesheet because the CSS bundler would inline them as data.
const fonts = [
  new FontFace('Space Grotesk Variable', `url(${grotesk}) format("woff2-variations")`, {
    weight: '300 700',
    display: 'swap',
  }),
  new FontFace('Space Mono', `url(${mono}) format("woff2")`, { weight: '400', display: 'swap' }),
  new FontFace('Space Mono', `url(${monoBold}) format("woff2")`, {
    weight: '700',
    display: 'swap',
  }),
];
for (const font of fonts) {
  document.fonts.add(font);
  void font.load();
}

// ---- helpers ----
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const set = ({ id, text }: { id: string; text: string }) => {
  $(id).textContent = text;
};
const setHtml = ({ id, html }: { id: string; html: string }) => {
  $(id).innerHTML = html;
};
const n0 = (n: number | null | undefined) =>
  n == null ? '–' : Math.round(n).toLocaleString('en-US');
const n1 = (n: number | null | undefined) =>
  n == null
    ? '–'
    : (Math.round(n * TENTHS) / TENTHS).toLocaleString('en-US', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      });
function dur(seconds: number | null | undefined): string {
  if (seconds == null) {
    return '–';
  }
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / S_PER_DAY);
  const h = Math.floor((s % S_PER_DAY) / S_PER_HOUR);
  const m = Math.floor((s % S_PER_HOUR) / S_PER_MIN);
  if (d) {
    return `${d}d ${h}h`;
  }
  if (h) {
    return `${h}h ${m}m`;
  }
  if (m) {
    return `${m}m ${s % S_PER_MIN}s`;
  }
  return `${s}s`;
}
const ago = (s: number | null | undefined) => (s == null ? '–' : `${dur(s)} ago`);
function mbOrGb(mb: number | null | undefined): string {
  if (mb == null) {
    return '–';
  }
  if (mb >= KIB) {
    return `${n1(mb / KIB)} GB`;
  }
  return mb >= 1 ? `${n0(mb)} MB` : `${n0(mb * KIB)} KB`;
}
const kbps = (k: number | null | undefined) =>
  k == null ? '–' : k >= KIB ? `${n1(k / KIB)} MB/s` : `${n1(k)} KB/s`;
const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`)
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .toLowerCase();
const dayOf = (unixS: number) => new Date(unixS * MS_PER_S).toISOString().slice(0, DAY_KEY_LENGTH);
const nowS = () => Math.floor(Date.now() / MS_PER_S);
const flag = (cc: string) =>
  String.fromCodePoint(...[...cc].map((c) => REGIONAL_INDICATOR_A + c.charCodeAt(0) - CHAR_CODE_A));
function countryName(cc: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(cc) ?? cc;
  } catch {
    return cc;
  }
}

// ---- pixels: a string per row, a char per cell ----
function px({ rows, ink }: { rows: string[]; ink: string }): string {
  let out = '';
  for (const [y, row] of rows.entries()) {
    for (const [x, cell] of [...row].entries()) {
      if (cell === 'X') {
        out += `<rect x="${x}" y="${y}" width="1" height="1" fill="${ink}"/>`;
      }
    }
  }
  return out;
}
const ICONS: Record<string, string[]> = {
  'first-light': ['...X...', '.X.X.X.', '..XXX..', 'XXXXXXX', '..XXX..', '.X.X.X.', '...X...'],
  centurion: ['XXXXXXX', 'X.XXX.X', 'X.XXX.X', '.XXXXX.', '..XXX..', '...X...', '.XXXXX.'],
  crowd: ['.......', '.X.X.X.', 'XXXXXXX', '.X.X.X.', '.......', 'XXXXXXX', 'XXXXXXX'],
  worldwide: ['.XXXXX.', 'X..X..X', 'XXXXXXX', 'X..X..X', 'XXXXXXX', 'X..X..X', '.XXXXX.'],
  survivor: ['XXXXXXX', 'X..X..X', 'X..X..X', 'XXXXXXX', '.X...X.', '.XX.XX.', '..XXX..'],
  'power-nap': ['..XXXX.', '.XX....', 'XX.....', 'XX.....', 'XX.....', '.XX....', '..XXXX.'],
  marathon: ['...XXX.', '..XXX..', '.XXX...', 'XXXXXXX', '...XXX.', '..XXX..', '.XXX...'],
  booped: ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'],
};

// ---- the creature: bbot, moods driven by cpu ----
const face = createFace($('face'), { expression: 'content' });
createFace($('sleepy'), { expression: 'sleep', track: false, blink: false, idle: false });
let mood = 'content';
let boopTimer = 0;
function setMood(next: string) {
  mood = next;
  if (!boopTimer) {
    face.setExpression(next);
  }
}

// ---- boop ----
const boopBtn = $('boop') as HTMLButtonElement;
let boops: number | null = null;
async function boop() {
  face.react('bounce');
  face.setExpression('joy');
  clearTimeout(boopTimer);
  boopTimer = window.setTimeout(() => {
    boopTimer = 0;
    face.setExpression(mood);
  }, BOOP_FACE_MS);
  if (boops != null) {
    set({ id: 'boops', text: n0(++boops) });
  }
  try {
    const res = await fetch('/api/boop', { method: 'POST' });
    const body = (await res.json()) as BoopPayload;
    boops = body.boops;
    set({ id: 'boops', text: n0(boops) });
    set({ id: 'v-boops', text: n0(boops) });
  } catch {
    // the count refreshes with the next /api/hits anyway
  }
}
boopBtn.addEventListener('click', () => void boop());
$('face').addEventListener('click', () => void boop());
document.addEventListener('keydown', (e) => {
  if (e.key === 'b' && !e.metaKey && !e.ctrlKey && document.activeElement === document.body) {
    void boop();
  }
});

// ---- HUD segments ----
function segs({ id, pct }: { id: string; pct: number | null }) {
  const el = $(id);
  if (pct == null) {
    el.innerHTML = '';
    return;
  }
  const on = Math.round((SEGMENTS * Math.max(0, Math.min(PERCENT, pct))) / PERCENT);
  const pressure =
    id === 'seg-xp' ? '' : pct <= SEG_CRIT_PCT ? ' crit' : pct <= SEG_WARN_PCT ? ' warn' : '';
  el.className = el.className.replace(/ (warn|crit)/g, '') + pressure;
  let html = '';
  for (let i = 0; i < SEGMENTS; i++) {
    html += `<i class="${i < on ? 'on' : ''}"></i>`;
  }
  el.innerHTML = html;
}

// ---- traces: time on x (last hour), gaps where the vm slept ----
type Series = { data: (number | null)[]; color: string };
type Trace = { id: string; t: number[]; series: Series[]; floor: number; interval: number };

type Scale = { x: (ts: number) => number; y: (v: number) => number; gap: number };

/** One series as a filled area and a line, broken wherever two samples are further apart than a nap. */
function seriesPaths({ t, s, scale }: { t: number[]; s: Series; scale: Scale }): string {
  let line = '';
  let area = '';
  let open = false;
  let startX = 0;
  let lastX = 0;
  const close = () => {
    if (open) {
      area += ` L${lastX.toFixed(1)},${TRACE_H} L${startX.toFixed(1)},${TRACE_H} Z`;
      open = false;
    }
  };
  for (const [i, ts] of t.entries()) {
    const v = s.data[i];
    const prev = t[i - 1];
    if (v == null || (prev != null && ts - prev > scale.gap)) {
      close();
    }
    if (v == null) {
      continue;
    }
    const point = `${scale.x(ts).toFixed(1)},${scale.y(v).toFixed(1)}`;
    line += open ? ` L${point}` : ` M${point}`;
    area += open ? ` L${point}` : ` M${point}`;
    if (!open) {
      startX = scale.x(ts);
      open = true;
    }
    lastX = scale.x(ts);
  }
  close();
  return `<path d="${area}" fill="${s.color}" opacity="0.13"/><path class="line" d="${line}" fill="none" stroke="${s.color}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`;
}

function tracePaths({ t, series, floor, interval }: Trace): string {
  const t0 = nowS() - S_PER_HOUR;
  let max = floor;
  for (const s of series) {
    for (const v of s.data) {
      if (v != null && v > max) {
        max = v;
      }
    }
  }
  const scale: Scale = {
    x: (ts) => Math.max(0, Math.min(TRACE_W, ((ts - t0) / S_PER_HOUR) * TRACE_W)),
    y: (v) => TRACE_H - TRACE_PAD - ((TRACE_H - 2 * TRACE_PAD) * v) / max,
    gap: interval * TRACE_GAP_TICKS,
  };
  return series.map((s) => seriesPaths({ t, s, scale })).join('');
}
const trace = (spec: Trace) => setHtml({ id: spec.id, html: tracePaths(spec) });

type BarValue = { v: number | null; title: string };
function bars({ id, values }: { id: string; values: BarValue[] }) {
  const max = Math.max(1, ...values.map((b) => b.v ?? 0));
  const last = values.length - 1;
  let html = '';
  for (const [i, b] of values.entries()) {
    const cls = (b.v ?? 0) > 0 ? (i === last ? 'today' : 'on') : '';
    const height = Math.max(BAR_MIN_PCT, (PERCENT * (b.v ?? 0)) / max);
    html += `<i class="${cls}" style="height:${height}%" title="${b.title}"></i>`;
  }
  setHtml({ id, html });
}
function pixels({ id, values }: { id: string; values: BarValue[] }) {
  const cls = (v: number | null) =>
    v == null ? 'none' : v >= PIXEL_FULL_PCT ? 'on' : v > 0 ? 'part' : '';
  setHtml({
    id,
    html: values.map((b) => `<i class="${cls(b.v)}" title="${b.title}"></i>`).join(''),
  });
}

// ---- stats ----
let statsAt = 0;
let hitsAt = 0;
let sampleTs = 0;
let machineDone = false;

function renderSheet(s: StatsPayload) {
  const cpu = s.cpu.pct;
  setMood(
    cpu == null || cpu < CPU_FOCUS_PCT ? 'content' : cpu < CPU_WORRIED_PCT ? 'focus' : 'worried',
  );
  setHtml({ id: 'mood', html: `mood <b>${mood}</b>` });
  set({ id: 'hp', text: `${n0(s.mem.avail_mb)} / ${n0(s.mem.total_mb)} MB` });
  segs({ id: 'seg-hp', pct: (PERCENT * s.mem.avail_mb) / s.mem.total_mb });
  set({ id: 'en', text: cpu == null ? '–' : `${n1(PERCENT - cpu)}%` });
  segs({ id: 'seg-en', pct: cpu == null ? null : PERCENT - cpu });
  if (s.disk) {
    set({ id: 'dsk', text: `${n1(s.disk.free_gb)} / ${n1(s.disk.total_gb)} GB` });
    segs({ id: 'seg-dsk', pct: PERCENT - s.disk.used_pct });
  }
  set({ id: 'uptime', text: dur(s.process_uptime_s) });
}

function renderTraces(s: StatsPayload) {
  const cpu = s.cpu.pct;
  set({ id: 'cpu-rd', text: cpu == null ? '–' : `${n1(cpu)}%` });
  set({ id: 'load1', text: s.cpu.load[0].toFixed(2) });
  set({ id: 'net-rd', text: s.net ? `↓ ${kbps(s.net.rx_kbps)} ↑ ${kbps(s.net.tx_kbps)}` : '–' });
  set({
    id: 'xfer',
    text: s.net ? `↓${mbOrGb(s.net.rx_total_mb)} ↑${mbOrGb(s.net.tx_total_mb)}` : '–',
  });
  const { t, cpu: cpuHist, rx, tx } = s.history;
  trace({
    id: 'c-cpu',
    t,
    series: [{ data: cpuHist, color: GREEN }],
    floor: CPU_TRACE_FLOOR,
    interval: s.interval_s,
  });
  trace({
    id: 'c-net',
    t,
    series: [
      { data: rx, color: BLUE },
      { data: tx, color: GREEN },
    ],
    floor: 1,
    interval: s.interval_s,
  });
}

function renderReadout(s: StatsPayload) {
  const swap = s.mem.swap_used_mb > 0 ? ` · swap ${n0(s.mem.swap_used_mb)} MB` : '';
  set({ id: 'mem', text: `${n0(s.mem.used_mb)} MB` });
  set({ id: 'mem-sub', text: `${n1(s.mem.pct)}% used${swap}` });
  if (s.disk) {
    set({ id: 'disk', text: `${n1(s.disk.used_gb)} GB` });
    set({ id: 'disk-sub', text: `${n1(s.disk.used_pct)}% used` });
  }
  set({ id: 'load', text: s.cpu.load.map((v) => v.toFixed(2)).join(' ') });
  set({ id: 'procs', text: `${n0(s.procs)} procs` });
  set({ id: 'rss', text: `${n0(s.process.rss_mb)} MB` });
  set({ id: 'rss-sub', text: `rss · ${s.process.runtime.toLowerCase()}` });
  const ms = (v: number | null) => (v == null ? '–' : v < TINY_MS ? '<0.01' : v.toFixed(2));
  set({ id: 'rt', text: `${ms(s.response.median_ms)} ms` });
  set({ id: 'rt-sub', text: `p95 ${ms(s.response.p95_ms)} ms` });
  set({ id: 'vm-up', text: dur(s.uptime_s) });
  set({ id: 'boots', text: `boot #${s.boots.count}` });
  set({ id: 'born', text: dayLabel(dayOf(s.boots.first)) });
  const nap = s.naps.last;
  set({
    id: 'naps',
    text: nap
      ? `${s.naps.today} nap${s.naps.today === 1 ? '' : 's'} today · last one ${dur(nap.s)}, woke ${ago(nowS() - nap.end)}`
      : 'no naps recorded yet',
  });
}

function renderMachine(s: StatsPayload) {
  const m = s.machine;
  const rows: [string, string, string][] = [
    ['vCPU', `${s.cpu.load[0].toFixed(2)} / ${m.cores}`, m.cpu.toLowerCase()],
    [
      'Memory',
      `${n0(s.mem.used_mb)} MB / ${n0(s.mem.total_mb)} MB`,
      `${n0(s.process.rss_mb)} MB of it is this process`,
    ],
    [
      'Volume',
      s.disk ? `${n0(s.disk.used_gb * KIB)} MB / ${n1(s.disk.total_gb)} GB` : '–',
      'at /app/data, survives redeploys',
    ],
    [
      'Kernel',
      `linux ${m.kernel}`,
      m.hypervisor ? 'a microvm: the cpu flags say hypervisor' : 'bare metal',
    ],
    [
      'Runtime',
      `${m.runtime.toLowerCase()} · linux/${m.arch}`,
      'one binary, page and fonts inside',
    ],
    ['Edge', 'cloudflare → caddy → eth0', "tls, http/2, the visitor's ip and country as headers"],
  ];
  const width = Math.max(...rows.map((r) => r[1].length)) + TERM_GAP;
  setHtml({
    id: 'term-rows',
    html: rows
      .map(
        ([k, v, c]) =>
          `${k.padEnd(TERM_KEY_WIDTH)}<b>${v}</b>${' '.repeat(width - v.length)}<span class="c">${c}</span>`,
      )
      .join('\n'),
  });
  if (!machineDone) {
    machineDone = true;
    set({ id: 'hero-ram', text: `${m.ram_mb} MB` });
  }
}

async function loadStats() {
  try {
    const s = (await fetch('/api/stats', { cache: 'no-store' }).then((r) =>
      r.json(),
    )) as StatsPayload;
    if (!s.ts) {
      return;
    }
    statsAt = Date.now();
    sampleTs = s.ts;
    renderSheet(s);
    renderTraces(s);
    renderReadout(s);
    renderMachine(s);
  } catch (e) {
    console.warn('stats', e);
  }
}

// ---- hits ----
function badge(a: Achievement): string {
  const title =
    a.unlocked && a.at
      ? `unlocked ${dayLabel(dayOf(a.at))}`
      : `${Math.round(a.progress * PERCENT)}%`;
  const icon = px({ rows: ICONS[a.id] ?? [], ink: a.unlocked ? INK_UNLOCKED : INK_LOCKED });
  return `<div class="badge${a.unlocked ? ' on' : ''}" title="${title}"><div class="ico"><svg viewBox="0 0 7 7" shape-rendering="crispEdges">${icon}</svg></div><div><div class="n">${a.name}</div><div class="d">${a.desc}</div><div class="p"><i style="width:${Math.round(a.progress * PERCENT)}%"></i></div></div></div>`;
}

function renderVisitors(h: HitsPayload) {
  set({ id: 'v-now', text: n0(h.now) });
  set({ id: 'v-peak', text: n0(h.peak) });
  set({ id: 'v-total', text: n0(h.total_views) });
  set({ id: 'v-today', text: n0(h.today.views) });
  set({ id: 'v-uniq', text: n0(h.today.visitors) });
  if (boops == null || h.boops > boops) {
    boops = h.boops;
    set({ id: 'boops', text: n0(boops) });
  }
  set({ id: 'v-boops', text: n0(h.boops) });
  const geo = h.countries
    .slice(0, COUNTRIES_SHOWN)
    .map(
      (c) =>
        `<span title="${countryName(c.cc)}"><span class="fl">${flag(c.cc)}</span><b>${n0(c.views)}</b></span>`,
    )
    .join('');
  setHtml({ id: 'geo', html: geo || '<span>nobody yet today</span>' });
  bars({
    id: 'b-views',
    values: h.days.map((d) => ({
      v: d.views,
      title: `${dayLabel(d.day)}: ${d.views} views, ${d.visitors} people`,
    })),
  });
  set({ id: 'ax-views-0', text: dayLabel(h.days[0]?.day ?? h.today.day) });
}

function renderGame(h: HitsPayload) {
  const L = h.level;
  set({ id: 'lvl', text: String(L.lvl) });
  set({ id: 'lvl-eyebrow', text: String(L.lvl) });
  set({ id: 'xp', text: n0(L.xp) });
  set({ id: 'xp-next', text: `next at ${n0(L.next)}` });
  segs({ id: 'seg-xp', pct: (PERCENT * (L.xp - L.floor)) / (L.next - L.floor) });
  setHtml({ id: 'ach', html: h.achievements.map(badge).join('') });
  const unlocked = h.achievements.filter((a) => a.unlocked).length;
  set({ id: 'ach-when', text: `${unlocked} / ${h.achievements.length}` });
}

function renderAwake(h: HitsPayload) {
  set({
    id: 'avail',
    text:
      h.availability_pct == null ? '–' : String(Math.round(h.availability_pct * TENTHS) / TENTHS),
  });
  set({
    id: 'avail-since',
    text: dayLabel(h.days.find((d) => d.up_pct != null)?.day ?? h.today.day),
  });
  pixels({
    id: 'b-avail',
    values: h.days.map((d) => ({
      v: d.up_pct,
      title:
        d.up_pct == null
          ? `${dayLabel(d.day)}: before first boot`
          : `${dayLabel(d.day)}: awake ${d.up_pct}%`,
    })),
  });
  set({ id: 'ax-avail-0', text: dayLabel(h.days[0]?.day ?? h.today.day) });
}

async function loadHits() {
  try {
    const h = (await fetch('/api/hits', { cache: 'no-store' }).then((r) =>
      r.json(),
    )) as HitsPayload;
    hitsAt = Date.now();
    renderVisitors(h);
    renderGame(h);
    renderAwake(h);
  } catch (e) {
    console.warn('hits', e);
  }
}

function ticker() {
  if (statsAt) {
    const since = nowS() - sampleTs;
    const stale = since > STALE_AFTER_S;
    set({ id: 'stats-when', text: `sampled ${ago(since)}` });
    $('status-chip').className = `chip${stale ? ' bad' : ''}`;
    set({ id: 'status-text', text: stale ? 'collector late' : 'online' });
  }
  if (hitsAt) {
    set({ id: 'hits-when', text: `updated ${ago(Math.round((Date.now() - hitsAt) / MS_PER_S))}` });
  }
}

void loadStats();
void loadHits();
ticker();
setInterval(() => void loadStats(), STATS_EVERY_MS);
setInterval(() => void loadHits(), HITS_EVERY_MS);
setInterval(ticker, TICKER_EVERY_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    void loadStats();
    void loadHits();
  }
});
