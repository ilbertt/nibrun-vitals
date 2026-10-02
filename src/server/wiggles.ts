import { db } from '#store.ts';
import type { WigglesPayload } from '#types.ts';

const MS_PER_S = 1000;
export const WIGGLE_INTERVAL_S = 900;
const GRACE_S = 60;
// The host dispatches cron against its clock; a guest clock just behind it must still
// recognize the intended quarter hour rather than reject it as the previous slot.
const EARLY_GRACE_S = 5;
const RECENT_SLOTS = 16;

db.exec(`
  CREATE TABLE IF NOT EXISTS wiggle_clock (
    id INTEGER PRIMARY KEY CHECK (id = 1), started INTEGER NOT NULL, first_due INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS wiggles (slot INTEGER PRIMARY KEY, performed INTEGER NOT NULL);
`);
const qClock = db.query<{ started: number; first_due: number }, []>(
  'SELECT started, first_due FROM wiggle_clock WHERE id = 1',
);
const qStart = db.query('INSERT OR IGNORE INTO wiggle_clock VALUES (1, ?, ?)');
const qWiggle = db.query('INSERT OR IGNORE INTO wiggles (slot, performed) VALUES (?, ?)');
const qTotal = db.query<{ count: number; last: number | null }, []>(
  'SELECT COUNT(*) count, MAX(performed) last FROM wiggles',
);
const qCompleted = db.query<{ count: number }, [number]>(
  'SELECT COUNT(*) count FROM wiggles WHERE slot <= ?',
);
const qRecent = db.query<{ slot: number; performed: number }, [number]>(
  'SELECT slot, performed FROM wiggles WHERE slot >= ? ORDER BY slot',
);

export function startWiggles({ now = Date.now() }: { now?: number } = {}) {
  const started = Math.floor(now / MS_PER_S);
  const firstDue = (Math.floor(started / WIGGLE_INTERVAL_S) + 1) * WIGGLE_INTERVAL_S;
  qStart.run(started, firstDue);
}

// One receipt per real quarter-hour invocation. Retries cannot double-count, and a restart
// never fills old gaps. SQLite serializes writes from the HTTP and cron processes.
export function performWiggle({ now = Date.now() }: { now?: number } = {}): boolean {
  const clock = qClock.get();
  const performed = Math.floor(now / MS_PER_S);
  const slot = Math.floor((performed + EARLY_GRACE_S) / WIGGLE_INTERVAL_S) * WIGGLE_INTERVAL_S;
  if (!clock || slot < clock.first_due || performed - slot >= GRACE_S) {
    return false;
  }
  return qWiggle.run(slot, performed).changes > 0;
}

export function wiggles({ now = Date.now() }: { now?: number } = {}): WigglesPayload {
  const clock = qClock.get();
  if (!clock) {
    throw new Error('Wiggle schedule has not started');
  }
  const ts = Math.floor(now / MS_PER_S);
  const currentSlot = Math.floor(ts / WIGGLE_INTERVAL_S) * WIGGLE_INTERVAL_S;
  const matureSlot = Math.floor((ts - GRACE_S) / WIGGLE_INTERVAL_S) * WIGGLE_INTERVAL_S;
  const expected = Math.max(0, (currentSlot - clock.first_due) / WIGGLE_INTERVAL_S + 1);
  const mature = Math.max(0, (matureSlot - clock.first_due) / WIGGLE_INTERVAL_S + 1);
  const end = Math.max(currentSlot, clock.first_due);
  const start = Math.max(clock.first_due, end - (RECENT_SLOTS - 1) * WIGGLE_INTERVAL_S);
  const receipts = new Map(qRecent.all(start).map((row) => [row.slot, row.performed]));
  const recent: WigglesPayload['recent'] = [];
  for (let slot = start; slot <= end; slot += WIGGLE_INTERVAL_S) {
    const performed = receipts.get(slot) ?? null;
    recent.push({
      slot,
      performed,
      status: performed != null ? 'done' : slot <= matureSlot ? 'missed' : 'pending',
    });
  }
  const total = qTotal.get()!;
  return {
    ts,
    started: clock.started,
    first_due: clock.first_due,
    interval_s: WIGGLE_INTERVAL_S,
    grace_s: GRACE_S,
    count: total.count,
    expected,
    missed: mature - qCompleted.get(matureSlot)!.count,
    last: total.last,
    next: Math.max(clock.first_due, currentSlot + WIGGLE_INTERVAL_S),
    recent,
  };
}
