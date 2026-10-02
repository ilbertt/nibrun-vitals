import { afterAll, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENTRYPOINT, PUBLIC_DIR_NAME, PUBLIC_DIR_NAME_CONSTANT_NAME } from './shared/constants.ts';

const dataDir = mkdtempSync(join(tmpdir(), 'vitals-wiggles-'));
const previousDataDir = process.env.NIBRUN_DATA_DIR;
process.env.NIBRUN_DATA_DIR = dataDir;
const { performWiggle, startWiggles, wiggles, WIGGLE_INTERVAL_S } = await import('#wiggles.ts');
const { boots, db, getMeta } = await import('#store.ts');

const MS_PER_S = 1000;
const TWO = 2;
const THREE = 3;
const RECENT_SLOTS = 16;
const CRON_COMMAND = [
  process.execPath,
  'run',
  '--define',
  `${PUBLIC_DIR_NAME_CONSTANT_NAME}="${PUBLIC_DIR_NAME}"`,
  ENTRYPOINT,
];
const at = (time: string) => Date.parse(`2026-10-02T${time}Z`);

beforeEach(() => {
  db.exec('DELETE FROM wiggles; DELETE FROM wiggle_clock;');
  startWiggles({ now: at('12:07:00') });
});
afterAll(() => {
  db.close();
  if (previousDataDir == null) {
    delete process.env.NIBRUN_DATA_DIR;
  } else {
    process.env.NIBRUN_DATA_DIR = previousDataDir;
  }
  rmSync(dataDir, { recursive: true, force: true });
});

test('starts at the next UTC quarter hour and preserves the original clock on redeploy', () => {
  expect(performWiggle({ now: at('12:14:59') })).toBe(false);
  const original = wiggles({ now: at('12:07:00') });
  expect(original.started).toBe(at('12:07:00') / MS_PER_S);
  expect(original.first_due).toBe(at('12:15:00') / MS_PER_S);
  expect(original.expected).toBe(0);
  expect(original.missed).toBe(0);
  expect(original.recent[0]?.status).toBe('pending');
  startWiggles({ now: at('13:00:00') });
  expect(wiggles({ now: at('13:00:00') }).started).toBe(original.started);
  expect(wiggles({ now: at('13:00:00') }).first_due).toBe(original.first_due);
});

test('counts real runs once per slot and reads receipts without writing a wiggle', () => {
  expect(performWiggle({ now: at('12:15:01') })).toBe(true);
  expect(performWiggle({ now: at('12:15:02') })).toBe(false);
  expect(performWiggle({ now: at('12:30:01') })).toBe(true);
  const result = wiggles({ now: at('12:31:00') });
  expect(result.count).toBe(TWO);
  expect(result.expected).toBe(TWO);
  expect(result.missed).toBe(0);
  expect(result.last).toBe(at('12:30:01') / MS_PER_S);
  expect(result.next).toBe(at('12:45:00') / MS_PER_S);
  expect(wiggles({ now: at('12:31:00') })).toEqual(result);
});

test('gives a due job 60 seconds of grace and never backfills skipped quarters', () => {
  expect(wiggles({ now: at('12:15:59') }).missed).toBe(0);
  expect(wiggles({ now: at('12:15:59') }).recent[0]?.status).toBe('pending');
  expect(wiggles({ now: at('12:16:00') }).missed).toBe(1);
  expect(wiggles({ now: at('12:16:00') }).recent[0]?.status).toBe('missed');
  expect(performWiggle({ now: at('12:16:01') })).toBe(false);
  expect(wiggles({ now: at('12:16:02') }).missed).toBe(1);
  performWiggle({ now: at('12:45:01') });
  const result = wiggles({ now: at('12:46:00') });
  expect(result.count).toBe(1);
  expect(result.expected).toBe(THREE);
  expect(result.missed).toBe(TWO);
  expect(result.recent.map((slot) => slot.status)).toEqual(['missed', 'missed', 'done']);
});

test('bounds the recent strip while keeping all-time missed accounting', () => {
  performWiggle({ now: at('20:00:01') });
  const result = wiggles({ now: at('20:01:00') });
  expect(result.recent.length).toBe(RECENT_SLOTS);
  expect(result.missed).toBe(result.expected - result.count);
  expect(result.recent.at(-1)?.status).toBe('done');
});

test('overlapping cron processes share one receipt and never count as HTTP boots', async () => {
  // Use the real clock for subprocess dispatch; the pure attendance tests above use fixed dates.
  db.exec('DELETE FROM wiggle_clock;');
  startWiggles({ now: Date.now() - WIGGLE_INTERVAL_S * MS_PER_S });
  const quarter = Math.floor(Date.now() / MS_PER_S / WIGGLE_INTERVAL_S) * WIGGLE_INTERVAL_S;
  // The live command respects the grace period. Shift only the test clock's Date.now in the
  // child so this concurrency check works at any minute of the hour.
  const childCode = `
    Date.now = () => ${quarter * MS_PER_S + MS_PER_S};
    process.argv.push('--cron-title=mandatory-wiggle');
    await import('./${ENTRYPOINT}');
  `;
  const commands = Array.from({ length: TWO }, () =>
    Bun.spawn(
      [
        process.execPath,
        '--define',
        `${PUBLIC_DIR_NAME_CONSTANT_NAME}="${PUBLIC_DIR_NAME}"`,
        '--eval',
        childCode,
      ],
      {
        env: { ...process.env, NIBRUN_DATA_DIR: dataDir },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    ),
  );
  for (const proc of commands) {
    const error = await new Response(proc.stderr).text();
    expect(await proc.exited, error).toBe(0);
  }
  expect(wiggles().count).toBe(1);
  expect(boots().count).toBe(0);
  expect(getMeta('first_boot')).toBeNull();
});

test('unknown cron titles fail before starting HTTP or recording a boot', async () => {
  const proc = Bun.spawn([...CRON_COMMAND, '--cron-title=unknown'], {
    env: { ...process.env, NIBRUN_DATA_DIR: dataDir },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(await proc.exited).toBe(1);
  expect(await new Response(proc.stderr).text()).toContain('Unknown cron job');
  expect(wiggles().count).toBe(0);
  expect(boots().count).toBe(0);
});

test('a bundled development build selects the OS scheduler from the production runtime', async () => {
  const built = await Bun.build({
    entrypoints: ['src/server/crons.ts'],
    target: 'bun',
    format: 'esm',
    minify: { whitespace: true, syntax: true },
    define: { 'process.env.NODE_ENV': JSON.stringify('development') },
  });
  expect(built.success).toBe(true);
  const source = await built.outputs[0]!.text();
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const code = `
    Bun.cron = (...args) => {
      if (args.length !== 3) throw Error('In-process scheduler selected in production');
      console.log('OS scheduler selected');
      return Promise.resolve();
    };
    const { registerCrons } = await import(${JSON.stringify(moduleUrl)});
    await registerCrons({ entrypoint: 'vitals' });
  `;
  const proc = Bun.spawn([process.execPath, '--eval', code], {
    env: { ...process.env, NIBRUN_DATA_DIR: dataDir, NODE_ENV: 'production' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const error = await new Response(proc.stderr).text();
  expect(await proc.exited, error).toBe(0);
  expect(await new Response(proc.stdout).text()).toContain('OS scheduler selected');
});
