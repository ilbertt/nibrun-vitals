// What the page receives over the wire. Imported type-only on both sides, so this file has
// no imports of its own.

export type Mem = {
  total_mb: number;
  used_mb: number;
  avail_mb: number;
  pct: number;
  swap_total_mb: number;
  swap_used_mb: number;
};

export type Disk = {
  path: string;
  total_gb: number;
  used_gb: number;
  free_gb: number;
  used_pct: number;
};

export type Net = {
  iface: string;
  rx_kbps: number;
  tx_kbps: number;
  rx_total_mb: number;
  tx_total_mb: number;
};

export type Load = [one: number, five: number, fifteen: number];

export type Machine = {
  cpu: string;
  cores: number;
  arch: string;
  hypervisor: boolean;
  product: string | null;
  vendor: string | null;
  ram_mb: number;
  disk_gb: number | null;
  disk_path: string;
  os: string;
  kernel: string;
  runtime: string;
  hostname: string;
  iface: string | null;
};

export type Sample = {
  /** unix seconds */
  t: number;
  cpu: number | null;
  /** percent */
  mem: number;
  /** kbps */
  rx: number;
  tx: number;
  /** mb */
  rss: number;
};

export type StatsPayload = {
  ts: number;
  interval_s: number;
  uptime_s: number;
  process_uptime_s: number;
  boots: { count: number; last: number; first: number };
  naps: { today: number; today_s: number; last: { start: number; end: number; s: number } | null };
  cpu: { pct: number | null; cores: number; load: Load };
  mem: Mem;
  disk: Disk | null;
  net: Net | null;
  procs: number | null;
  process: { rss_mb: number; runtime: string };
  response: { median_ms: number | null; p95_ms: number | null; n: number };
  machine: Machine;
  history: {
    t: number[];
    cpu: (number | null)[];
    mem: number[];
    rx: number[];
    tx: number[];
    rss: number[];
  };
};

export type DaySummary = { day: string; views: number; visitors: number; up_pct: number | null };

export type Achievement = {
  id: string;
  name: string;
  desc: string;
  progress: number;
  unlocked: boolean;
  at: number | null;
};

export type HitsPayload = {
  ts: number;
  now: number;
  peak: number;
  peak_at: number | null;
  window_s: number;
  countries: { cc: string; views: number }[];
  boops: number;
  level: { lvl: number; xp: number; floor: number; next: number };
  achievements: Achievement[];
  today: DaySummary;
  days: DaySummary[];
  total_views: number;
  availability_pct: number;
};

export type BoopPayload = { boops: number };
