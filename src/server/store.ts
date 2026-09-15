// Everything that must outlive a redeploy lives in one SQLite file on the volume.
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { DATA_DIR } from '#collector.ts';
import type { Sample } from '#types.ts';

const MS_PER_S = 1000;
const S_PER_HOUR = 3600;
const S_PER_DAY = 86_400;
const DAY_MS = S_PER_DAY * MS_PER_S;
const PERCENT = 100;
const TENTHS = 10;
const DAY_KEY_LENGTH = 10;
const SEEN_KEEP_DAYS = 1;
const HISTORY_KEEP_DAYS = 14;
const COUNTRIES_LIMIT = 8;

mkdirSync(DATA_DIR, { recursive: true });
export const db = new Database(`${DATA_DIR}/vitals.db`, { create: true });
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS daily (
    day TEXT PRIMARY KEY,
    views INTEGER NOT NULL DEFAULT 0,
    visitors INTEGER NOT NULL DEFAULT 0,
    up_seconds INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS seen (day TEXT NOT NULL, h TEXT NOT NULL, PRIMARY KEY (day, h));
  CREATE TABLE IF NOT EXISTS geo (
    day TEXT NOT NULL,
    cc TEXT NOT NULL,
    views INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, cc)
  );
  CREATE TABLE IF NOT EXISTS samples (
    t INTEGER PRIMARY KEY, cpu REAL, mem REAL, rx REAL, tx REAL, rss REAL
  );
  CREATE TABLE IF NOT EXISTS boots (t INTEGER PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS naps (start INTEGER PRIMARY KEY, end INTEGER NOT NULL);
`);

export const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, DAY_KEY_LENGTH);
const dayStartS = (day: string) => Date.parse(`${day}T00:00:00Z`) / MS_PER_S;
const nowS = () => Math.floor(Date.now() / MS_PER_S);

// ---- meta ----
const qGetMeta = db.query<{ value: string }, [string]>('SELECT value FROM meta WHERE key = ?');
const qSetMeta = db.query(
  'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
);
export const getMeta = (key: string) => qGetMeta.get(key)?.value ?? null;
export const setMeta = ({ key, value }: { key: string; value: string | number }) =>
  qSetMeta.run(key, String(value));

// The salt makes visitor hashes unlinkable to an address without the volume; it rotates with the day key.
function loadSalt(): string {
  const existing = getMeta('salt');
  if (existing) {
    return existing;
  }
  const fresh = crypto.randomUUID();
  setMeta({ key: 'salt', value: fresh });
  return fresh;
}
export const salt = loadSalt();

// ---- hits ----
const qSeen = db.query('INSERT OR IGNORE INTO seen (day, h) VALUES (?, ?)');
const qHit = db.query(
  `INSERT INTO daily (day, views, visitors) VALUES (?, 1, ?)
   ON CONFLICT(day) DO UPDATE SET views = views + 1, visitors = visitors + excluded.visitors`,
);
const qGeo = db.query(
  'INSERT INTO geo (day, cc, views) VALUES (?, ?, 1) ON CONFLICT(day, cc) DO UPDATE SET views = views + 1',
);
const qCountries = db.query<{ cc: string; views: number }, [string, number]>(
  'SELECT cc, views FROM geo WHERE day = ? ORDER BY views DESC, cc LIMIT ?',
);

export function recordHit({ day, h, country }: { day: string; h: string; country: string | null }) {
  const fresh = qSeen.run(day, h).changes > 0 ? 1 : 0;
  qHit.run(day, fresh);
  if (country && /^[A-Z]{2}$/.test(country)) {
    qGeo.run(day, country);
  }
}
export const countries = (day: string) => qCountries.all(day, COUNTRIES_LIMIT);

// ---- uptime accounting: one row per UTC day, seconds the process was up and sampling ----
const qUp = db.query(
  `INSERT INTO daily (day, up_seconds) VALUES (?, ?)
   ON CONFLICT(day) DO UPDATE SET up_seconds = MIN(${S_PER_DAY}, up_seconds + excluded.up_seconds)`,
);
export const tickUptime = ({ day, seconds }: { day: string; seconds: number }) =>
  qUp.run(day, seconds);

// ---- samples: the last hour, so a redeploy shows up as a gap rather than a blank chart ----
const qAddSample = db.query(
  'INSERT OR REPLACE INTO samples (t, cpu, mem, rx, tx, rss) VALUES (?, ?, ?, ?, ?, ?)',
);
const qPruneSamples = db.query('DELETE FROM samples WHERE t < ?');
const qSamples = db.query<Sample, [number]>(
  'SELECT t, cpu, mem, rx, tx, rss FROM samples WHERE t >= ? ORDER BY t',
);
export function addSample(s: Sample) {
  qAddSample.run(s.t, s.cpu, s.mem, s.rx, s.tx, s.rss);
  qPruneSamples.run(s.t - S_PER_HOUR);
}
export const loadSamples = (sinceS: number) => qSamples.all(sinceS);

// ---- boots ----
db.query('INSERT OR IGNORE INTO boots (t) VALUES (?)').run(nowS());
if (!getMeta('first_boot')) {
  setMeta({ key: 'first_boot', value: nowS() });
}
export const firstBoot = Number(getMeta('first_boot'));
const qBoots = db.query<{ n: number; last: number }, []>(
  'SELECT COUNT(*) n, MAX(t) last FROM boots',
);
export function boots() {
  const row = qBoots.get()!;
  return { count: row.n, last: row.last };
}

// ---- naps: nibrun pauses the VM after a few quiet minutes and resumes it on the next request.
// The process never restarts; it only sees the clock jump between two ticks.
const qAddNap = db.query('INSERT OR IGNORE INTO naps (start, end) VALUES (?, ?)');
const qNaps = db.query<{ n: number; total: number }, [number]>(
  'SELECT COUNT(*) n, COALESCE(SUM(end - start), 0) total FROM naps WHERE end >= ?',
);
const qLastNap = db.query<{ start: number; end: number }, []>(
  'SELECT start, end FROM naps ORDER BY end DESC LIMIT 1',
);
export const addNap = ({ startS, endS }: { startS: number; endS: number }) =>
  qAddNap.run(startS, endS);
export function naps(sinceS: number) {
  const today = qNaps.get(sinceS)!;
  const last = qLastNap.get();
  return {
    today: today.n,
    today_s: today.total,
    last: last ? { start: last.start, end: last.end, s: last.end - last.start } : null,
  };
}

// ---- boops: the one thing a visitor can do to it ----
export let boops = Number(getMeta('boops') ?? 0);
export function bump() {
  boops++;
  setMeta({ key: 'boops', value: boops });
  return boops;
}

// ---- achievements are derived from what is already recorded; only the first-unlock time is kept ----
const qMaxCountries = db.query<{ n: number }, []>(
  'SELECT COALESCE(MAX(n), 0) n FROM (SELECT COUNT(*) n FROM geo GROUP BY day)',
);
const qLongestNap = db.query<{ s: number }, []>('SELECT COALESCE(MAX(end - start), 0) s FROM naps');
export function achievementInputs() {
  return {
    maxCountriesDay: qMaxCountries.get()!.n,
    longestNapS: qLongestNap.get()!.s,
    lastNapEnd: qLastNap.get()?.end ?? null,
  };
}
export function unlockedAt({ id, unlocked }: { id: string; unlocked: boolean }): number | null {
  const key = `ach:${id}`;
  const value = getMeta(key);
  if (value) {
    return Number(value);
  }
  if (!unlocked) {
    return null;
  }
  const at = nowS();
  setMeta({ key, value: at });
  return at;
}

// ---- housekeeping ----
export function prune(nowMs: number) {
  db.query('DELETE FROM seen WHERE day < ?').run(dayKey(nowMs - SEEN_KEEP_DAYS * DAY_MS));
  db.query('DELETE FROM geo WHERE day < ?').run(dayKey(nowMs - HISTORY_KEEP_DAYS * DAY_MS));
  db.query('DELETE FROM naps WHERE end < ?').run(
    Math.floor((nowMs - HISTORY_KEEP_DAYS * DAY_MS) / MS_PER_S),
  );
}
prune(Date.now());

// ---- summaries for the page ----
type DailyRow = { day: string; views: number; visitors: number; up_seconds: number };
const qDaily = db.query<DailyRow, [string]>(
  'SELECT day, views, visitors, up_seconds FROM daily WHERE day >= ? ORDER BY day',
);
const qTotals = db.query<{ views: number; up: number }, []>(
  'SELECT COALESCE(SUM(views), 0) views, COALESCE(SUM(up_seconds), 0) up FROM daily',
);

export type DaySummary = { day: string; views: number; visitors: number; up_pct: number | null };

/** A day is measured from its start, or from the first boot on the day the app first came up. */
function daySummary({ day, now, row }: { day: string; now: number; row?: DailyRow }): DaySummary {
  const firstDay = dayKey(firstBoot * MS_PER_S);
  const start = Math.max(dayStartS(day), day === firstDay ? firstBoot : 0);
  const end = day === dayKey(now) ? Math.floor(now / MS_PER_S) : dayStartS(day) + S_PER_DAY;
  const denominator = Math.max(1, end - start);
  return {
    day,
    views: row?.views ?? 0,
    visitors: row?.visitors ?? 0,
    up_pct:
      day < firstDay
        ? null
        : Math.min(PERCENT, Math.round((PERCENT * (row?.up_seconds ?? 0)) / denominator)),
  };
}

export function summary(now: number) {
  const days = HISTORY_KEEP_DAYS;
  const byDay = new Map(qDaily.all(dayKey(now - (days - 1) * DAY_MS)).map((r) => [r.day, r]));
  const series: DaySummary[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = dayKey(now - i * DAY_MS);
    series.push(daySummary({ day, now, row: byDay.get(day) }));
  }
  const totals = qTotals.get()!;
  const sinceS = Math.max(1, Math.floor(now / MS_PER_S) - firstBoot);
  return {
    today: series[series.length - 1]!,
    days: series,
    total_views: totals.views,
    availability_pct:
      Math.min(PERCENT, Math.round((PERCENT * TENTHS * Math.min(totals.up, sinceS)) / sinceS)) /
      TENTHS,
  };
}
