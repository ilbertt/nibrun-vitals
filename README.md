# nibrun-vitals

[![Deploy on nibrun](https://nibrun.com/button.svg)](https://nibrun.com/deploy/nibrun-vitals)

The microVM serving the page, as a face you can boop: live CPU, memory, disk and network from
`/proc`, visitors, naps, achievements, and mandatory dance breaks every 15 minutes. One Bun binary,
SQLite on the volume, no third-party requests.
Live at [vitals-linux-x64-hr6jnb.nibrun.app](https://vitals-linux-x64-hr6jnb.nibrun.app).

`Bun.cron` registers `mandatory-wiggle` on nibrun at `*/15 * * * *` (UTC), waking the app even
when nobody is watching. Each on-time run saves one SQLite receipt for its quarter hour. The page shows
the count, when the schedule started, the last and next dance breaks, and recent attendance.
Duplicate invocations do not double-count; missed slots turn red after a 60-second grace period
and are never filled by a late or later run. The schedule and receipts survive redeploys. Keep the page
closed to observe scheduled wakeups, since its live refreshes keep the app awake.

Face by [bbot](https://bbot.bwnd.app). Public domain, see [LICENSE](./LICENSE). To hack on it,
see [CONTRIBUTING](./.github/CONTRIBUTING.md).
