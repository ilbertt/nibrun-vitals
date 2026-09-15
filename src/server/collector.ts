// Reads the machine's vitals straight from /proc and the data volume.
// Every reader degrades to null when a file is missing (macOS dev, odd kernels).
import { readdirSync, readFileSync, statfsSync } from 'node:fs';
import os from 'node:os';
import type { Disk, Load, Machine, Mem, Net, Sample } from '#types.ts';

export const DATA_DIR = process.env.NIBRUN_DATA_DIR ?? './data';
export const INTERVAL_S = 10;

const KIB = 1024;
const MIB = KIB * KIB;
const GIB = MIB * KIB;
const PERCENT = 100;
const MS_PER_S = 1000;
const TENTHS = 10;
const HUNDREDTHS = 100;

const r1 = (n: number) => Math.round(n * TENTHS) / TENTHS;
const r2 = (n: number) => Math.round(n * HUNDREDTHS) / HUNDREDTHS;
const mb = (bytes: number) => Math.round(bytes / MIB);
const gb = (bytes: number) => r1(bytes / GIB);
const read = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

// ---- cpu: delta of idle vs total jiffies between two reads of /proc/stat ----
const STAT_IDLE = 3;
const STAT_IOWAIT = 4;
let prevCpu: [idle: number, total: number] | null = null;

export function cpuPct(): number | null {
  const stat = read('/proc/stat');
  if (!stat) {
    return null;
  }
  const fields = stat.slice(0, stat.indexOf('\n')).trim().split(/\s+/).slice(1).map(Number);
  const idle = (fields[STAT_IDLE] ?? 0) + (fields[STAT_IOWAIT] ?? 0);
  let total = 0;
  for (const field of fields) {
    total += field;
  }
  const prev = prevCpu;
  prevCpu = [idle, total];
  if (!prev) {
    return null;
  }
  const dt = total - prev[1];
  return dt > 0 ? r1(Math.max(0, PERCENT * (1 - (idle - prev[0]) / dt))) : 0;
}

// ---- memory ----
export function mem(): Mem {
  const meminfo = read('/proc/meminfo');
  if (!meminfo) {
    const total = os.totalmem();
    const avail = os.freemem();
    return {
      total_mb: mb(total),
      used_mb: mb(total - avail),
      avail_mb: mb(avail),
      pct: r1((PERCENT * (total - avail)) / total),
      swap_total_mb: 0,
      swap_used_mb: 0,
    };
  }
  const bytes = (key: string) =>
    Number(meminfo.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'))?.[1] ?? 0) * KIB;
  const total = bytes('MemTotal');
  const avail = bytes('MemAvailable');
  const swapTotal = bytes('SwapTotal');
  const swapFree = bytes('SwapFree');
  return {
    total_mb: mb(total),
    used_mb: mb(total - avail),
    avail_mb: mb(avail),
    pct: total ? r1((PERCENT * (total - avail)) / total) : 0,
    swap_total_mb: mb(swapTotal),
    swap_used_mb: mb(swapTotal - swapFree),
  };
}

// ---- disk: the persistent volume the app owns ----
export function disk(): Disk | null {
  try {
    const stats = statfsSync(DATA_DIR);
    const total = stats.blocks * stats.bsize;
    const free = stats.bavail * stats.bsize;
    const used = total - free;
    return {
      path: DATA_DIR,
      total_gb: gb(total),
      used_gb: gb(used),
      free_gb: gb(free),
      used_pct: total ? r1((PERCENT * used) / total) : 0,
    };
  } catch {
    return null;
  }
}

// ---- network: the busiest non-loopback interface in /proc/net/dev ----
const NET_HEADER_LINES = 2;
const NET_TX_BYTES = 8;
let prevNet: { rx: number; tx: number; t: number } | null = null;

function busiestInterface(dev: string): { iface: string; rx: number; tx: number } | null {
  let best: { iface: string; rx: number; tx: number } | null = null;
  for (const line of dev.split('\n').slice(NET_HEADER_LINES)) {
    const colon = line.indexOf(':');
    if (colon < 0) {
      continue;
    }
    const iface = line.slice(0, colon).trim();
    if (iface === 'lo') {
      continue;
    }
    const fields = line
      .slice(colon + 1)
      .trim()
      .split(/\s+/)
      .map(Number);
    const rx = fields[0] ?? 0;
    const tx = fields[NET_TX_BYTES] ?? 0;
    if (!best || rx + tx > best.rx + best.tx) {
      best = { iface, rx, tx };
    }
  }
  return best;
}

export function net(): Net | null {
  const dev = read('/proc/net/dev');
  if (!dev) {
    return null;
  }
  const best = busiestInterface(dev);
  if (!best) {
    return null;
  }
  const now = Date.now();
  let rxKbps = 0;
  let txKbps = 0;
  if (prevNet) {
    const dt = (now - prevNet.t) / MS_PER_S;
    if (dt > 0) {
      rxKbps = r1(Math.max(0, best.rx - prevNet.rx) / dt / KIB);
      txKbps = r1(Math.max(0, best.tx - prevNet.tx) / dt / KIB);
    }
  }
  prevNet = { rx: best.rx, tx: best.tx, t: now };
  return {
    iface: best.iface,
    rx_kbps: rxKbps,
    tx_kbps: txKbps,
    rx_total_mb: r2(best.rx / MIB),
    tx_total_mb: r2(best.tx / MIB),
  };
}

// ---- load, processes, uptime ----
export function load(): Load {
  const loadavg = read('/proc/loadavg');
  if (!loadavg) {
    return os.loadavg().map(r2) as Load;
  }
  const [one, five, fifteen] = loadavg.split(' ');
  return [Number(one), Number(five), Number(fifteen)];
}

export function procs(): number | null {
  try {
    let n = 0;
    for (const entry of readdirSync('/proc')) {
      if (/^\d+$/.test(entry)) {
        n++;
      }
    }
    return n;
  } catch {
    return null;
  }
}

export const uptimeS = () => Math.round(os.uptime());
export const rssMb = () => r1(process.memoryUsage.rss() / MIB);

// ---- what the machine is: read once at boot ----
export function machine(): Machine {
  const cpuinfo = read('/proc/cpuinfo') ?? '';
  // x86 has "model name" (after a bare numeric "model" line); arm kernels only give "Hardware".
  const model = (
    cpuinfo.match(/^model name\s*:\s*(.+)$/m)?.[1] ??
    cpuinfo.match(/^Hardware\s*:\s*(.+)$/m)?.[1] ??
    os.cpus()[0]?.model ??
    `${process.arch} cpu`
  )
    .replace(/\s+/g, ' ')
    .trim();
  // nibrun's rootfs carries no os-release at all, so "Linux" is all that can honestly be said.
  const osRelease = read('/etc/os-release') ?? read('/usr/lib/os-release') ?? '';
  const pretty =
    osRelease.match(/^PRETTY_NAME="?(.*?)"?$/m)?.[1] ??
    (process.platform === 'linux' ? 'Linux, minimal rootfs' : `${os.type()} ${os.release()}`);
  const dmi = (key: string) => read(`/sys/class/dmi/id/${key}`)?.trim() || null;
  const volume = disk();
  return {
    cpu: model,
    cores: os.cpus().length || 1,
    arch: process.arch,
    hypervisor: /\bhypervisor\b/.test(cpuinfo),
    product: dmi('product_name'),
    vendor: dmi('sys_vendor'),
    ram_mb: mem().total_mb,
    disk_gb: volume?.total_gb ?? null,
    disk_path: DATA_DIR,
    os: pretty,
    kernel: os.release(),
    runtime: `Bun ${Bun.version}`,
    hostname: process.env.NIBRUN_HOSTNAME ?? os.hostname(),
    iface: net()?.iface ?? null,
  };
}

export function sample() {
  const memory = mem();
  const network = net();
  const s: Sample = {
    t: Math.floor(Date.now() / MS_PER_S),
    cpu: cpuPct(),
    mem: memory.pct,
    rx: network?.rx_kbps ?? 0,
    tx: network?.tx_kbps ?? 0,
    rss: rssMb(),
  };
  return { s, mem: memory, disk: disk(), net: network, load: load(), procs: procs() };
}
